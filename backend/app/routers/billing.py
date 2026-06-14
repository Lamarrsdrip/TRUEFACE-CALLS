from __future__ import annotations

import hashlib
import hmac
import json
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from ..billing_rules import NAIRA_CURRENCY, require_naira_amount
from ..entitlements import current_entitlement, require_paid_subscription
from ..errors import api_error
from ..manual_payments import (
    enforce_manual_amount,
    expire_manual_payments,
    generate_payment_reference,
    manual_bank_details,
    payment_expiry,
)
from ..payment_fulfillment import fulfill_payment
from ..routers.providers import provider_values
from ..security import current_user
from ..serializers import json_safe, utc_now

router = APIRouter(prefix="/api", tags=["billing"])


def _subscription_payload(db, user_id: str) -> dict | None:
    plan, subscription = current_entitlement(db, user_id)
    if not subscription:
        return None
    return {
        **json_safe({k: v for k, v in subscription.items() if k != "_id"}),
        "plan": json_safe({k: v for k, v in plan.items() if k != "_id"}),
    }


def _credit_packs(db) -> list[dict]:
    setting = db.app_settings.find_one(
        {"namespace": "billing", "key": "credit-packs"}
    )
    source = (setting or {}).get("publicValue", {}).get("packs", [])
    return [
        {
            "key": pack["key"],
            "name": pack.get("name", pack["key"].replace("-", " ").title()),
            "creditsMilli": pack["creditsMilli"],
            "amountMinor": pack.get("amountMinor", pack.get("priceMinor", 0)),
            "currency": NAIRA_CURRENCY,
        }
        for pack in source
    ]


@router.get("/plans")
def plans(request: Request) -> list[dict]:
    return json_safe(
        list(
            request.app.state.db.plans.find(
                {"enabled": True}, {"_id": 0}
            ).sort("sortOrder", 1)
        )
    )


@router.get("/billing/subscription")
def subscription(request: Request, user: dict = Depends(current_user)):
    return _subscription_payload(request.app.state.db, user["id"])


@router.get("/billing/payments")
def payments(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    expire_manual_payments(request.app.state.db, user["id"])
    return json_safe(
        list(
            request.app.state.db.payments.find(
                {"userId": user["id"]}, {"_id": 0}
            ).sort("createdAt", -1)
        )
    )


@router.get("/billing/payments/{payment_id}")
def payment(
    payment_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    expire_manual_payments(request.app.state.db, user["id"])
    record = request.app.state.db.payments.find_one(
        {"id": payment_id, "userId": user["id"]}, {"_id": 0}
    )
    if not record:
        raise HTTPException(status_code=404, detail="Payment not found")
    return json_safe(record)


@router.get("/billing/credit-packs")
def credit_packs(request: Request, user: dict = Depends(current_user)) -> dict:
    require_paid_subscription(request.app.state.db, user["id"])
    return {"packs": _credit_packs(request.app.state.db)}


@router.get("/billing/payment-methods")
def payment_methods(
    request: Request, _user: dict = Depends(current_user)
) -> dict:
    methods = []
    manual_config = provider_values(request, "manual-bank")
    try:
        manual_bank_details(manual_config)
        methods.append({"key": "bank", "label": "Bank transfer", "primary": True})
    except HTTPException:
        pass
    for key, label in (
        ("paystack", "Paystack"),
        ("flutterwave", "Flutterwave"),
    ):
        config = provider_values(request, key)
        if (
            config.get("enabled", "false").lower() == "true"
            and config.get("secretKey")
        ):
            methods.append({"key": key, "label": label, "primary": False})
    return {"methods": methods}


def _checkout_payment(
    db,
    user_id: str,
    provider: str,
    payment_type: str,
    amount: int,
    metadata: dict,
    **extra,
) -> dict:
    now = utc_now()
    payment = {
        "id": str(uuid.uuid4()),
        "userId": user_id,
        "provider": provider.upper(),
        "type": payment_type,
        "status": "PENDING",
        "amountMinor": require_naira_amount(amount),
        "currency": NAIRA_CURRENCY,
        "creditsMilli": metadata.get("creditsMilli"),
        "idempotencyKey": str(uuid.uuid4()),
        "metadata": metadata,
        "createdAt": now,
        "updatedAt": now,
        **extra,
    }
    db.payments.insert_one(payment)
    return payment


@router.post("/billing/checkout/subscription")
def subscription_checkout(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    provider = str(body.get("provider", "")).lower()
    if provider not in {"paystack", "flutterwave"}:
        raise HTTPException(status_code=422, detail="Unsupported payment provider")
    plan = request.app.state.db.plans.find_one(
        {"id": body.get("planId"), "enabled": True}
    )
    if not plan or plan["priceMonthlyMinor"] <= 0:
        raise HTTPException(status_code=404, detail="Paid plan not found")
    config = provider_values(request, provider)
    if (
        config.get("enabled", "true").lower() != "true"
        or not config.get("secretKey")
    ):
        raise HTTPException(status_code=503, detail=f"{provider} is not configured")
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        provider,
        "SUBSCRIPTION",
        plan["priceMonthlyMinor"],
        {"planId": plan["id"]},
    )
    checkout_url = _create_gateway_checkout(provider, config, payment, user, request)
    request.app.state.db.payments.update_one(
        {"id": payment["id"]}, {"$set": {"externalReference": payment["id"]}}
    )
    return {"checkoutUrl": checkout_url, "paymentId": payment["id"]}


@router.post("/billing/checkout/credits")
def credit_checkout(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    require_paid_subscription(request.app.state.db, user["id"])
    pack = next(
        (
            item
            for item in _credit_packs(request.app.state.db)
            if item["key"] == body.get("packKey")
        ),
        None,
    )
    if not pack:
        raise HTTPException(status_code=404, detail="Credit pack not found")
    provider = str(body.get("provider", "")).lower()
    if provider not in {"paystack", "flutterwave"}:
        raise HTTPException(status_code=422, detail="Unsupported payment provider")
    config = provider_values(request, provider)
    if (
        config.get("enabled", "true").lower() != "true"
        or not config.get("secretKey")
    ):
        raise HTTPException(status_code=503, detail=f"{provider} is not configured")
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        provider,
        "CREDIT_PURCHASE",
        pack["amountMinor"],
        {"creditPackKey": pack["key"], "creditsMilli": pack["creditsMilli"]},
    )
    return {
        "checkoutUrl": _create_gateway_checkout(provider, config, payment, user, request),
        "paymentId": payment["id"],
    }


def _create_gateway_checkout(provider: str, config: dict, payment: dict, user: dict, request: Request) -> str:
    callback = f"{request.app.state.settings.app_url}/billing"
    try:
        if provider == "paystack":
            response = httpx.post(
                "https://api.paystack.co/transaction/initialize",
                headers={"Authorization": f"Bearer {config['secretKey']}"},
                json={
                    "email": user["email"],
                    "amount": payment["amountMinor"],
                    "currency": payment["currency"],
                    "reference": payment["id"],
                    "callback_url": callback,
                },
                timeout=10,
            )
            response.raise_for_status()
            return response.json()["data"]["authorization_url"]
        if provider == "flutterwave":
            response = httpx.post(
                "https://api.flutterwave.com/v3/payments",
                headers={"Authorization": f"Bearer {config['secretKey']}"},
                json={
                    "tx_ref": payment["id"],
                    "amount": payment["amountMinor"] / 100,
                    "currency": payment["currency"],
                    "redirect_url": callback,
                    "customer": {"email": user["email"], "name": user["displayName"]},
                },
                timeout=10,
            )
            response.raise_for_status()
            return response.json()["data"]["link"]
    except Exception as error:
        request.app.state.db.payments.update_one(
            {"id": payment["id"]},
            {
                "$set": {
                    "status": "FAILED",
                    "failureMessage": type(error).__name__,
                    "updatedAt": utc_now(),
                }
            },
        )
        raise HTTPException(status_code=502, detail=f"{provider} checkout failed") from error
    raise HTTPException(status_code=422, detail="Unsupported payment provider")


def _manual_selection(body: dict, request: Request, user: dict) -> tuple[int, dict, str]:
    payment_type = str(body.get("type", "")).lower()
    metadata = {}
    if payment_type == "subscription":
        plan = request.app.state.db.plans.find_one(
            {"id": body.get("planId"), "enabled": True}
        )
        if not plan or plan["priceMonthlyMinor"] <= 0:
            raise HTTPException(status_code=404, detail="Paid plan not found")
        amount = plan["priceMonthlyMinor"]
        metadata.update({"planId": plan["id"], "planName": plan["name"]})
        record_type = "SUBSCRIPTION"
    elif payment_type == "credits":
        require_paid_subscription(request.app.state.db, user["id"])
        pack = next(
            (
                item
                for item in _credit_packs(request.app.state.db)
                if item["key"] == body.get("creditPackKey")
            ),
            None,
        )
        if not pack:
            raise HTTPException(status_code=404, detail="Credit pack not found")
        amount = pack["amountMinor"]
        metadata.update(
            {
                "creditPackKey": pack["key"],
                "creditPackName": pack["name"],
                "creditsMilli": pack["creditsMilli"],
            }
        )
        record_type = "CREDIT_PURCHASE"
    else:
        raise HTTPException(status_code=422, detail="Invalid manual payment type")
    return amount, metadata, record_type


def _create_manual_session(body: dict, request: Request, user: dict) -> dict:
    config = provider_values(request, "manual-bank")
    bank = manual_bank_details(config)
    amount, metadata, record_type = _manual_selection(body, request, user)
    enforce_manual_amount(amount, bank)
    checkout_key = str(body.get("checkoutKey", "")).strip()
    if checkout_key:
        existing = request.app.state.db.payments.find_one(
            {
                "userId": user["id"],
                "provider": "MANUAL",
                "status": "PENDING",
                "metadata.checkoutKey": checkout_key,
            }
        )
        if existing:
            return {
                **json_safe(
                    {key: value for key, value in existing.items() if key != "_id"}
                ),
                "bank": {
                    key: value
                    for key, value in bank.items()
                    if key not in {"minimumMinor", "maximumMinor"}
                },
            }
        metadata["checkoutKey"] = checkout_key
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        "MANUAL",
        record_type,
        amount,
        metadata,
        paymentReference=generate_payment_reference(request.app.state.db),
        expiresAt=payment_expiry(bank["expiryMinutes"]),
        transferReference=None,
        proofObjectKey=None,
        submittedAt=None,
    )
    return {
        **json_safe({key: value for key, value in payment.items() if key != "_id"}),
        "bank": {
            key: value
            for key, value in bank.items()
            if key not in {"minimumMinor", "maximumMinor"}
        },
    }


@router.post("/billing/checkout/manual-session", status_code=201)
def create_manual_session(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    return _create_manual_session(body, request, user)


@router.post("/billing/checkout/manual-session/{payment_id}/submit")
def submit_manual_session(
    payment_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    expire_manual_payments(request.app.state.db, user["id"])
    payment = request.app.state.db.payments.find_one(
        {"id": payment_id, "userId": user["id"], "provider": "MANUAL"}
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Manual payment not found")
    if payment["status"] != "PENDING":
        return {"id": payment_id, "status": payment["status"]}
    transfer_reference = str(body.get("transferReference", "")).strip() or None
    proof_object_key = body.get("proofObjectKey") or None
    config = manual_bank_details(provider_values(request, "manual-bank"))
    if config["proofRequired"] and not proof_object_key:
        raise HTTPException(status_code=422, detail="A payment receipt is required")
    if proof_object_key:
        expected_prefix = f"payment-proofs/{user['id']}/"
        if not str(proof_object_key).startswith(expected_prefix):
            raise HTTPException(status_code=403, detail="Payment proof is not owned by this user")
        if not request.app.state.db.uploads.files.find_one(
            {"filename": proof_object_key}
        ):
            raise HTTPException(status_code=422, detail="Upload the payment receipt first")
    request.app.state.db.payments.update_one(
        {"id": payment_id, "status": "PENDING"},
        {
            "$set": {
                "transferReference": transfer_reference,
                "proofObjectKey": proof_object_key,
                "metadata.transferReference": transfer_reference,
                "metadata.proofObjectKey": proof_object_key,
                "submittedAt": utc_now(),
                "updatedAt": utc_now(),
            }
        },
    )
    return {
        "id": payment_id,
        "status": "PENDING",
        "message": "Payment is pending administrator confirmation",
    }


@router.post("/billing/checkout/manual")
def manual_checkout(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    session = _create_manual_session(body, request, user)
    return submit_manual_session(session["id"], body, request, user)


@router.get("/billing/manual-bank")
def manual_bank(request: Request, _user: dict = Depends(current_user)) -> dict:
    config = provider_values(request, "manual-bank")
    try:
        details = manual_bank_details(config)
    except HTTPException:
        return {"enabled": False}
    return {
        "enabled": True,
        "currency": NAIRA_CURRENCY,
        **details,
    }


@router.post("/billing/manual-proof-upload")
def manual_proof_upload(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    content_type = str(body.get("contentType", ""))
    size_bytes = int(body.get("sizeBytes", 0))
    if content_type not in {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    }:
        raise HTTPException(status_code=422, detail="Receipt must be an image or PDF")
    if size_bytes <= 0 or size_bytes > 10_000_000:
        raise HTTPException(status_code=422, detail="Receipt must be under 10 MB")
    object_key = f"payment-proofs/{user['id']}/{uuid.uuid4()}"
    token = request.app.state.sign_upload(object_key, content_type)
    return {
        "objectKey": object_key,
        "url": f"/api/uploads/{object_key}?token={token}",
        "headers": {"content-type": content_type},
    }


@router.post("/webhooks/{provider}")
async def webhook(provider: str, request: Request) -> dict:
    raw = await request.body()
    config = provider_values(request, provider)
    if provider == "paystack":
        if not config.get("secretKey"):
            raise api_error(
                503,
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Paystack webhook verification is not configured",
            )
        expected = hmac.new(
            config.get("secretKey", "").encode(), raw, hashlib.sha512
        ).hexdigest()
        signature = request.headers.get("x-paystack-signature", "")
        valid = hmac.compare_digest(expected, signature)
    elif provider == "flutterwave":
        if not config.get("webhookHash"):
            raise api_error(
                503,
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Flutterwave webhook verification is not configured",
            )
        valid = hmac.compare_digest(
            config.get("webhookHash", ""), request.headers.get("verif-hash", "")
        )
    else:
        raise HTTPException(status_code=404, detail="Unknown provider")
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Webhook payload is invalid") from error
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    event_type = str(payload.get("event", "")).lower()
    if provider == "paystack":
        payment_id = str(data.get("reference", ""))
        succeeded = (
            event_type == "charge.success"
            and str(data.get("status", "")).lower() == "success"
        )
        terminal_failure = event_type == "charge.failed"
        received_minor = int(data.get("amount", 0) or 0)
    else:
        payment_id = str(data.get("tx_ref", ""))
        succeeded = (
            event_type == "charge.completed"
            and str(data.get("status", "")).lower() in {"successful", "success"}
        )
        terminal_failure = event_type == "charge.completed" and not succeeded
        received_minor = round(float(data.get("amount", 0) or 0) * 100)
    payment = request.app.state.db.payments.find_one(
        {"id": payment_id, "provider": provider.upper()}
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Webhook payment was not found")
    currency = str(data.get("currency", "")).upper()
    if not succeeded and not terminal_failure:
        return {"received": True, "settled": False, "ignored": True}
    if terminal_failure:
        request.app.state.db.payments.update_one(
            {"id": payment_id, "status": "PENDING"},
            {"$set": {"status": "FAILED", "updatedAt": utc_now()}},
        )
        return {"received": True, "settled": False}
    if currency != NAIRA_CURRENCY or received_minor != payment["amountMinor"]:
        request.app.state.db.payments.update_one(
            {"id": payment_id},
            {
                "$set": {
                    "status": "REVIEW_REQUIRED",
                    "failureMessage": "Webhook amount or currency mismatch",
                    "updatedAt": utc_now(),
                }
            },
        )
        raise HTTPException(status_code=409, detail="Webhook amount or currency mismatch")
    external_id = str(data.get("id") or hashlib.sha256(raw).hexdigest())
    duplicate_event = False
    try:
        request.app.state.db.webhook_events.insert_one(
            {
                "provider": provider,
                "externalId": external_id,
                "eventType": str(payload.get("event") or "unknown"),
                "status": "PROCESSING",
                "payloadRedacted": {
                    "paymentId": payment_id,
                    "amountMinor": received_minor,
                    "currency": currency,
                },
                "createdAt": utc_now(),
            }
        )
    except DuplicateKeyError:
        existing_event = request.app.state.db.webhook_events.find_one(
            {"provider": provider, "externalId": external_id}
        )
        if existing_event and existing_event.get("status") == "PROCESSED":
            fulfill_payment(request.app.state.db, payment)
            return {"received": True, "duplicate": True}
        duplicate_event = True
    request.app.state.db.payments.update_one(
        {"id": payment_id},
        {
            "$set": {
                "status": "SUCCEEDED",
                "externalReference": external_id,
                "settledAt": utc_now(),
                "updatedAt": utc_now(),
            }
        },
    )
    payment["status"] = "SUCCEEDED"
    fulfill_payment(request.app.state.db, payment)
    request.app.state.db.webhook_events.update_one(
        {"provider": provider, "externalId": external_id},
        {"$set": {"status": "PROCESSED", "processedAt": utc_now()}},
    )
    return {
        "received": True,
        "settled": True,
        **({"recovered": True} if duplicate_event else {}),
    }
