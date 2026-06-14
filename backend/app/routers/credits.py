from __future__ import annotations

import math
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..entitlements import current_entitlement
from ..security import current_user
from ..serializers import as_utc, iso, json_safe, utc_now

router = APIRouter(prefix="/api/credits", tags=["credits"])

DEFAULT_USAGE_RATES = {
    "baseCallMilliPerMinute": 500,
    "aiFaceMilliPerMinute": 2000,
    "voiceEffectMilliPerMinute": 2500,
    "cloudGpuMilliPerMinute": 5000,
    "lowMultiplier": 1.0,
    "standardMultiplier": 1.25,
    "hdMultiplier": 2.0,
    "participantMultiplierStep": 0.15,
    "paidReservationSeconds": 300,
    "trialReservationSeconds": 30,
}


def wallet_payload(db, user_id: str) -> dict:
    _release_expired_reservations(db, user_id)
    wallet = db.credit_wallets.find_one({"userId": user_id})
    plan, subscription = current_entitlement(db, user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Credit wallet not found")
    active_paid = bool(
        subscription
        and subscription["status"] == "ACTIVE"
        and plan["key"] != "trial"
        and plan["priceMonthlyMinor"] > 0
    )
    return {
        **{
            key: wallet.get(key, 0)
            for key in [
                "availableMilliCredits",
                "reservedMilliCredits",
                "includedMilliCredits",
                "purchasedMilliCredits",
                "lifetimePurchasedMilli",
                "lifetimeConsumedMilli",
            ]
        },
        "topUpAllowed": active_paid and plan.get("creditTopupsAllowed", False),
        "activePaidSubscription": active_paid,
        "nextResetAt": iso(wallet.get("includedResetAt")),
        "exhausted": wallet.get("availableMilliCredits", 0) <= 0,
        "plan": {"name": plan["name"], "monthlyCredits": plan["monthlyCredits"]},
    }


def usage_rates(db) -> dict:
    setting = db.app_settings.find_one(
        {"namespace": "billing", "key": "usage-rates"}
    )
    configured = (setting or {}).get("publicValue") or {}
    return {**DEFAULT_USAGE_RATES, **configured}


def _rate_context(
    db, user_id: str, room_id: str, mode: str, quality: str
) -> dict:
    room = db.call_rooms.find_one({"id": room_id})
    if (
        not room
        or room.get("status") not in {"OPEN", "ACTIVE"}
        or as_utc(room["expiresAt"]) <= utc_now()
    ):
        raise HTTPException(status_code=404, detail="Active call room not found")
    participant = db.call_participants.find_one(
        {
            "roomId": room_id,
            "userId": user_id,
            "state": {"$in": ["APPROVED", "JOINED"]},
        }
    )
    if not participant:
        raise HTTPException(status_code=403, detail="You are not approved for this call")
    plan, subscription = current_entitlement(db, user_id)
    if not subscription:
        raise HTTPException(
            status_code=403,
            detail="An active trial or paid subscription is required for metered features",
        )
    normalized_quality = quality.upper()
    if normalized_quality not in plan["allowedQualities"]:
        raise HTTPException(status_code=403, detail="Quality is not included in your plan")
    normalized_mode = mode.upper()
    if normalized_mode not in {"BASE_CALL", "AI_FACE", "VOICE_EFFECT", "CLOUD_GPU"}:
        raise HTTPException(status_code=422, detail="Unknown usage mode")
    if normalized_mode == "VOICE_EFFECT" and not plan.get("voiceEffects", False):
        raise HTTPException(status_code=403, detail="Voice effects are not included in your plan")
    if normalized_mode == "CLOUD_GPU" and not plan.get("cloudGpu", False):
        raise HTTPException(status_code=403, detail="Cloud GPU is not included in your plan")
    rates = usage_rates(db)
    base_key = {
        "BASE_CALL": "baseCallMilliPerMinute",
        "AI_FACE": "aiFaceMilliPerMinute",
        "VOICE_EFFECT": "voiceEffectMilliPerMinute",
        "CLOUD_GPU": "cloudGpuMilliPerMinute",
    }[normalized_mode]
    quality_key = {
        "LOW": "lowMultiplier",
        "STANDARD": "standardMultiplier",
        "HD": "hdMultiplier",
    }[normalized_quality]
    participant_count = db.call_participants.count_documents(
        {"roomId": room_id, "state": {"$in": ["APPROVED", "JOINED"]}}
    )
    participant_multiplier = 1 + max(0, participant_count - 1) * float(
        rates["participantMultiplierStep"]
    )
    rate = math.ceil(
        int(rates[base_key]) * float(rates[quality_key]) * participant_multiplier
    )
    return {
        "roomId": room_id,
        "mode": normalized_mode,
        "quality": normalized_quality,
        "milliCreditsPerMinute": rate,
        "participantCount": participant_count,
        "participantMultiplier": participant_multiplier,
        "reservationSeconds": (
            max(15, min(int(rates["trialReservationSeconds"]), 60))
            if plan["key"] == "trial"
            else max(60, min(int(rates["paidReservationSeconds"]), 1800))
        ),
    }


def _require_key(value: object, label: str) -> str:
    key = str(value or "").strip()
    if len(key) < 8 or len(key) > 240:
        raise HTTPException(status_code=422, detail=f"{label} is invalid")
    return key


@router.get("/wallet")
def get_wallet(request: Request, user: dict = Depends(current_user)) -> dict:
    return wallet_payload(request.app.state.db, user["id"])


@router.get("/transactions")
def transactions(
    request: Request, take: int = 50, user: dict = Depends(current_user)
) -> list[dict]:
    wallet = request.app.state.db.credit_wallets.find_one({"userId": user["id"]})
    if not wallet:
        raise HTTPException(status_code=404, detail="Credit wallet not found")
    records = (
        request.app.state.db.credit_transactions.find(
            {"walletId": wallet["id"]}, {"_id": 0}
        )
        .sort("createdAt", -1)
        .limit(max(1, min(take, 200)))
    )
    return json_safe(list(records))


@router.get("/quote")
def quote(
    roomId: str,
    mode: str,
    quality: str,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    context = _rate_context(
        request.app.state.db, user["id"], roomId, mode, quality
    )
    return {
        **context,
        "reservationMilli": math.ceil(
            context["milliCreditsPerMinute"] * context["reservationSeconds"] / 60
        ),
    }


@router.post("/meter/reserve")
def reserve(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    key = _require_key(body.get("idempotencyKey"), "Idempotency key")
    existing = db.credit_transactions.find_one(
        {"idempotencyKey": key, "userId": user["id"]}
    )
    if existing:
        if existing.get("status") == "PROCESSING":
            raise HTTPException(
                status_code=409,
                detail="This credit reservation is already being processed",
            )
        return json_safe({k: v for k, v in existing.items() if k != "_id"})
    _release_expired_reservations(db, user["id"])
    context = _rate_context(
        db,
        user["id"],
        str(body.get("roomId", "")),
        str(body.get("mode", "")),
        str(body.get("quality", "")),
    )
    amount = math.ceil(
        context["milliCreditsPerMinute"] * context["reservationSeconds"] / 60
    )
    wallet = db.credit_wallets.find_one({"userId": user["id"]})
    if not wallet or int(wallet.get("availableMilliCredits", 0)) < amount:
        raise HTTPException(status_code=402, detail="Insufficient credits")
    included = min(int(wallet.get("includedMilliCredits", 0)), amount)
    purchased = amount - included
    transaction = {
        "id": str(uuid.uuid4()),
        "walletId": wallet["id"],
        "userId": user["id"],
        "roomId": context["roomId"],
        "type": "RESERVATION",
        "status": "PROCESSING",
        "amountMilli": -amount,
        "reservationMilli": amount,
        "reservationRemainingMilli": amount,
        "reservationIncludedRemainingMilli": included,
        "reservationPurchasedRemainingMilli": purchased,
        "milliCreditsPerMinute": context["milliCreditsPerMinute"],
        "mode": context["mode"],
        "quality": context["quality"],
        "reservationSeconds": context["reservationSeconds"],
        "expiresAt": utc_now()
        + timedelta(seconds=context["reservationSeconds"] + 120),
        "balanceAfterMilli": None,
        "source": "call-meter",
        "reason": None,
        "idempotencyKey": key,
        "createdAt": utc_now(),
    }
    try:
        db.credit_transactions.insert_one(transaction)
    except DuplicateKeyError:
        existing = db.credit_transactions.find_one(
            {"idempotencyKey": key, "userId": user["id"]}
        )
        if existing and existing.get("status") != "PROCESSING":
            return json_safe({k: v for k, v in existing.items() if k != "_id"})
        raise HTTPException(
            status_code=409,
            detail="This credit reservation is already being processed",
        )
    wallet = db.credit_wallets.find_one_and_update(
        {
            "id": wallet["id"],
            "availableMilliCredits": {"$gte": amount},
            "includedMilliCredits": {"$gte": included},
            "purchasedMilliCredits": {"$gte": purchased},
        },
        {
            "$inc": {
                "availableMilliCredits": -amount,
                "includedMilliCredits": -included,
                "purchasedMilliCredits": -purchased,
                "reservedMilliCredits": amount,
                "reservedIncludedMilli": included,
                "reservedPurchasedMilli": purchased,
                "version": 1,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not wallet:
        db.credit_transactions.delete_one(
            {"id": transaction["id"], "status": "PROCESSING"}
        )
        raise HTTPException(status_code=409, detail="Credit balance changed; retry")
    transaction["status"] = "ACTIVE"
    transaction["balanceAfterMilli"] = wallet["availableMilliCredits"]
    db.credit_transactions.update_one(
        {"id": transaction["id"], "status": "PROCESSING"},
        {
            "$set": {
                "status": "ACTIVE",
                "balanceAfterMilli": wallet["availableMilliCredits"],
                "updatedAt": utc_now(),
            }
        },
    )
    return json_safe({k: v for k, v in transaction.items() if k != "_id"})


@router.post("/meter/settle")
def settle(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    client_window = _require_key(body.get("meteringWindow"), "Metering window")
    window = f"{user['id']}:{client_window}"
    reservation_id = str(body.get("reservationId", ""))
    reservation = db.credit_transactions.find_one(
        {
            "id": reservation_id,
            "userId": user["id"],
            "type": "RESERVATION",
            "status": "ACTIVE",
        }
    )
    if not reservation:
        raise HTTPException(status_code=404, detail="Active credit reservation not found")
    _rate_context(
        db,
        user["id"],
        reservation["roomId"],
        reservation["mode"],
        reservation["quality"],
    )
    milliseconds = int(body.get("billableMilliseconds", 0))
    if milliseconds < 1_000 or milliseconds > 60_000:
        raise HTTPException(
            status_code=422,
            detail="Billable window must be between 1 and 60 seconds",
        )
    now = utc_now()
    usage_id = str(uuid.uuid4())
    try:
        db.usage_minutes.insert_one(
            {
                "id": usage_id,
                "userId": user["id"],
                "reservationId": reservation_id,
                "roomId": reservation["roomId"],
                "meteringWindow": window,
                "status": "PROCESSING",
                "createdAt": now,
            }
        )
    except DuplicateKeyError:
        existing = db.usage_minutes.find_one(
            {"meteringWindow": window, "userId": user["id"]}
        )
        if existing and (
            existing.get("status") == "COMPLETED"
            or existing.get("milliCreditsCharged") is not None
        ):
            return json_safe({k: v for k, v in existing.items() if k != "_id"})
        raise HTTPException(
            status_code=409,
            detail="This metering window is already being processed",
        )
    rate = int(reservation["milliCreditsPerMinute"])
    charge = max(1, math.ceil(milliseconds * rate / 60_000))
    included_charge = min(
        int(reservation.get("reservationIncludedRemainingMilli", 0)), charge
    )
    purchased_charge = charge - included_charge
    updated_reservation = db.credit_transactions.find_one_and_update(
        {
            "id": reservation_id,
            "userId": user["id"],
            "status": "ACTIVE",
            "reservationRemainingMilli": {"$gte": charge},
            "reservationPurchasedRemainingMilli": {"$gte": purchased_charge},
        },
        {
            "$inc": {
                "reservationRemainingMilli": -charge,
                "reservationIncludedRemainingMilli": -included_charge,
                "reservationPurchasedRemainingMilli": -purchased_charge,
                "settledMilli": charge,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated_reservation:
        db.usage_minutes.delete_one({"id": usage_id, "status": "PROCESSING"})
        raise HTTPException(status_code=402, detail="Reserved credits are exhausted")
    wallet = db.credit_wallets.find_one_and_update(
        {
            "userId": user["id"],
            "reservedMilliCredits": {"$gte": charge},
            "reservedIncludedMilli": {"$gte": included_charge},
            "reservedPurchasedMilli": {"$gte": purchased_charge},
        },
        {
            "$inc": {
                "reservedMilliCredits": -charge,
                "reservedIncludedMilli": -included_charge,
                "reservedPurchasedMilli": -purchased_charge,
                "lifetimeConsumedMilli": charge,
                "version": 1,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not wallet:
        db.credit_transactions.update_one(
            {"id": reservation_id},
            {
                "$inc": {
                    "reservationRemainingMilli": charge,
                    "reservationIncludedRemainingMilli": included_charge,
                    "reservationPurchasedRemainingMilli": purchased_charge,
                    "settledMilli": -charge,
                }
            },
        )
        db.usage_minutes.delete_one({"id": usage_id, "status": "PROCESSING"})
        raise HTTPException(status_code=409, detail="Credit reservation changed; retry")
    usage = {
        "id": usage_id,
        "walletId": wallet["id"],
        "userId": user["id"],
        "reservationId": reservation_id,
        "roomId": reservation["roomId"],
        "mode": reservation["mode"],
        "quality": reservation["quality"],
        "billableMilliseconds": milliseconds,
        "milliCreditsPerMinute": rate,
        "milliCreditsCharged": charge,
        "meteringWindow": window,
        "status": "COMPLETED",
        "startedAt": now,
        "endedAt": now,
        "createdAt": now,
    }
    db.usage_minutes.update_one(
        {"id": usage_id, "status": "PROCESSING"},
        {"$set": {key: value for key, value in usage.items() if key != "id"}},
    )
    db.credit_transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "walletId": wallet["id"],
            "userId": user["id"],
            "roomId": reservation["roomId"],
            "reservationId": reservation_id,
            "type": "USAGE",
            "amountMilli": -charge,
            "balanceAfterMilli": wallet["availableMilliCredits"],
            "source": "call-meter",
            "reason": f"{reservation['mode']} {reservation['quality']}",
            "idempotencyKey": f"usage:{window}",
            "createdAt": now,
        }
    )
    return json_safe({k: v for k, v in usage.items() if k != "_id"})


@router.post("/meter/release")
def release(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    key = _require_key(body.get("idempotencyKey"), "Idempotency key")
    existing = db.credit_transactions.find_one(
        {"idempotencyKey": key, "userId": user["id"]}
    )
    if existing:
        return json_safe({k: v for k, v in existing.items() if k != "_id"})
    reservation_id = str(body.get("reservationId", ""))
    reservation = db.credit_transactions.find_one_and_update(
        {
            "id": reservation_id,
            "userId": user["id"],
            "type": "RESERVATION",
            "status": "ACTIVE",
        },
        {
            "$set": {
                "status": "RELEASED",
                "reservationRemainingMilli": 0,
                "reservationIncludedRemainingMilli": 0,
                "reservationPurchasedRemainingMilli": 0,
                "releasedAt": utc_now(),
                "updatedAt": utc_now(),
            }
        },
        return_document=ReturnDocument.BEFORE,
    )
    if not reservation:
        raise HTTPException(status_code=404, detail="Active credit reservation not found")
    amount = int(reservation.get("reservationRemainingMilli", 0))
    included = int(reservation.get("reservationIncludedRemainingMilli", 0))
    purchased = int(reservation.get("reservationPurchasedRemainingMilli", 0))
    wallet = db.credit_wallets.find_one_and_update(
        {
            "userId": user["id"],
            "reservedMilliCredits": {"$gte": amount},
            "reservedIncludedMilli": {"$gte": included},
            "reservedPurchasedMilli": {"$gte": purchased},
        },
        {
            "$inc": {
                "availableMilliCredits": amount,
                "includedMilliCredits": included,
                "purchasedMilliCredits": purchased,
                "reservedMilliCredits": -amount,
                "reservedIncludedMilli": -included,
                "reservedPurchasedMilli": -purchased,
                "version": 1,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not wallet:
        raise HTTPException(status_code=409, detail="Reservation cannot be released")
    transaction = {
        "id": str(uuid.uuid4()),
        "walletId": wallet["id"],
        "userId": user["id"],
        "roomId": reservation["roomId"],
        "reservationId": reservation_id,
        "type": "RESERVATION_RELEASE",
        "amountMilli": amount,
        "balanceAfterMilli": wallet["availableMilliCredits"],
        "source": "call-meter",
        "reason": None,
        "idempotencyKey": key,
        "createdAt": utc_now(),
    }
    db.credit_transactions.insert_one(transaction)
    return json_safe({k: v for k, v in transaction.items() if k != "_id"})


def _release_expired_reservations(db, user_id: str) -> None:
    for reservation in db.credit_transactions.find(
        {
            "userId": user_id,
            "type": "RESERVATION",
            "status": "ACTIVE",
            "expiresAt": {"$lte": utc_now()},
        }
    ):
        amount = int(reservation.get("reservationRemainingMilli", 0))
        included = int(
            reservation.get("reservationIncludedRemainingMilli", 0)
        )
        purchased = int(
            reservation.get("reservationPurchasedRemainingMilli", 0)
        )
        updated = db.credit_transactions.update_one(
            {
                "id": reservation["id"],
                "userId": user_id,
                "status": "ACTIVE",
            },
            {
                "$set": {
                    "status": "EXPIRED",
                    "reservationRemainingMilli": 0,
                    "reservationIncludedRemainingMilli": 0,
                    "reservationPurchasedRemainingMilli": 0,
                    "updatedAt": utc_now(),
                }
            },
        )
        if updated.modified_count and amount:
            db.credit_wallets.update_one(
                {
                    "id": reservation["walletId"],
                    "userId": user_id,
                    "reservedMilliCredits": {"$gte": amount},
                },
                {
                    "$inc": {
                        "availableMilliCredits": amount,
                        "includedMilliCredits": included,
                        "purchasedMilliCredits": purchased,
                        "reservedMilliCredits": -amount,
                        "reservedIncludedMilli": -included,
                        "reservedPurchasedMilli": -purchased,
                        "version": 1,
                    },
                    "$set": {"updatedAt": utc_now()},
                },
            )
