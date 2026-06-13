from __future__ import annotations

import hashlib
import hmac
import json
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from ..entitlements import current_entitlement, require_paid_subscription
from ..routers.providers import provider_values
from ..security import current_user
from ..serializers import iso, json_safe, utc_now

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
            "currency": pack.get("currency", "USD"),
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
    return json_safe(
        list(
            request.app.state.db.payments.find(
                {"userId": user["id"]}, {"_id": 0}
            ).sort("createdAt", -1)
        )
    )


@router.get("/billing/credit-packs")
def credit_packs(request: Request, user: dict = Depends(current_user)) -> dict:
    require_paid_subscription(request.app.state.db, user["id"])
    return {"packs": _credit_packs(request.app.state.db)}


def _checkout_payment(db, user_id: str, provider: str, payment_type: str, amount: int, currency: str, metadata: dict) -> dict:
    now = utc_now()
    payment = {
        "id": str(uuid.uuid4()),
        "userId": user_id,
        "provider": provider.upper(),
        "type": payment_type,
        "status": "PENDING",
        "amountMinor": amount,
        "currency": currency,
        "creditsMilli": metadata.get("creditsMilli"),
        "idempotencyKey": str(uuid.uuid4()),
        "metadata": metadata,
        "createdAt": now,
        "updatedAt": now,
    }
    db.payments.insert_one(payment)
    return payment


@router.post("/billing/checkout/subscription")
def subscription_checkout(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    provider = str(body.get("provider", "")).lower()
    plan = request.app.state.db.plans.find_one(
        {"id": body.get("planId"), "enabled": True}
    )
    if not plan or plan["priceMonthlyMinor"] <= 0:
        raise HTTPException(status_code=404, detail="Paid plan not found")
    config = provider_values(request, provider)
    if not config.get("secretKey"):
        raise HTTPException(status_code=503, detail=f"{provider} is not configured")
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        provider,
        "SUBSCRIPTION",
        plan["priceMonthlyMinor"],
        plan["currency"],
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
    config = provider_values(request, provider)
    if not config.get("secretKey"):
        raise HTTPException(status_code=503, detail=f"{provider} is not configured")
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        provider,
        "CREDIT_PURCHASE",
        pack["amountMinor"],
        pack["currency"],
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
        if provider == "stripe":
            response = httpx.post(
                "https://api.stripe.com/v1/checkout/sessions",
                auth=(config["secretKey"], ""),
                data={
                    "mode": "payment",
                    "success_url": callback,
                    "cancel_url": callback,
                    "client_reference_id": payment["id"],
                    "line_items[0][price_data][currency]": payment["currency"].lower(),
                    "line_items[0][price_data][unit_amount]": payment["amountMinor"],
                    "line_items[0][price_data][product_data][name]": "TrueFace Calls",
                    "line_items[0][quantity]": 1,
                },
                timeout=10,
            )
            response.raise_for_status()
            return response.json()["url"]
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


@router.post("/billing/checkout/manual")
def manual_checkout(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    payment_type = str(body.get("type", "")).lower()
    metadata = {
        "transferReference": str(body.get("transferReference", "")).strip(),
        "proofObjectKey": body.get("proofObjectKey"),
    }
    if not metadata["transferReference"]:
        raise HTTPException(status_code=422, detail="Transfer reference is required")
    if payment_type == "subscription":
        plan = request.app.state.db.plans.find_one(
            {"id": body.get("planId"), "enabled": True}
        )
        if not plan or plan["priceMonthlyMinor"] <= 0:
            raise HTTPException(status_code=404, detail="Paid plan not found")
        amount, currency = plan["priceMonthlyMinor"], plan["currency"]
        metadata["planId"] = plan["id"]
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
        amount, currency = pack["amountMinor"], pack["currency"]
        metadata.update(
            {"creditPackKey": pack["key"], "creditsMilli": pack["creditsMilli"]}
        )
        record_type = "CREDIT_PURCHASE"
    else:
        raise HTTPException(status_code=422, detail="Invalid manual payment type")
    payment = _checkout_payment(
        request.app.state.db,
        user["id"],
        "MANUAL",
        record_type,
        amount,
        currency,
        metadata,
    )
    payment["transferReference"] = metadata["transferReference"]
    request.app.state.db.payments.update_one(
        {"id": payment["id"]},
        {
            "$set": {
                "transferReference": metadata["transferReference"],
                "proofObjectKey": metadata.get("proofObjectKey"),
            }
        },
    )
    return {
        "id": payment["id"],
        "status": "PENDING",
        "message": "Payment submitted for administrator review",
    }


@router.get("/billing/manual-bank")
def manual_bank(request: Request, _user: dict = Depends(current_user)) -> dict:
    config = provider_values(request, "manual-bank")
    if config.get("enabled", "false").lower() != "true":
        return {"enabled": False}
    return {
        "enabled": True,
        **{
            key: config.get(key)
            for key in [
                "bankName",
                "accountName",
                "accountNumber",
                "currency",
                "minimumMinor",
                "maximumMinor",
                "proofRequired",
                "manualReviewRequired",
                "instructions",
            ]
        },
    }


@router.post("/billing/manual-proof-upload")
def manual_proof_upload(request: Request, user: dict = Depends(current_user)) -> dict:
    object_key = f"payment-proofs/{user['id']}/{uuid.uuid4()}"
    token = request.app.state.sign_upload(object_key)
    return {
        "objectKey": object_key,
        "url": f"/api/uploads/{object_key}?token={token}",
        "headers": {"content-type": "application/octet-stream"},
    }


@router.post("/webhooks/{provider}")
async def webhook(provider: str, request: Request) -> dict:
    raw = await request.body()
    config = provider_values(request, provider)
    if provider == "paystack":
        expected = hmac.new(
            config.get("secretKey", "").encode(), raw, hashlib.sha512
        ).hexdigest()
        signature = request.headers.get("x-paystack-signature", "")
        valid = hmac.compare_digest(expected, signature)
    elif provider == "flutterwave":
        valid = hmac.compare_digest(
            config.get("webhookHash", ""), request.headers.get("verif-hash", "")
        )
    elif provider == "stripe":
        valid = bool(config.get("webhookSecret") and request.headers.get("stripe-signature"))
    else:
        raise HTTPException(status_code=404, detail="Unknown provider")
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    payload = json.loads(raw or b"{}")
    external_id = str(payload.get("id") or payload.get("event") or hashlib.sha256(raw).hexdigest())
    if request.app.state.db.webhook_events.find_one(
        {"provider": provider, "externalId": external_id}
    ):
        return {"received": True, "duplicate": True}
    request.app.state.db.webhook_events.insert_one(
        {
            "provider": provider,
            "externalId": external_id,
            "eventType": str(payload.get("type") or payload.get("event") or "unknown"),
            "status": "RECEIVED",
            "payloadRedacted": {"id": external_id},
            "createdAt": utc_now(),
        }
    )
    return {"received": True}
