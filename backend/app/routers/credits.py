from __future__ import annotations

import math
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument

from ..entitlements import current_entitlement
from ..security import current_user
from ..serializers import iso, json_safe, utc_now

router = APIRouter(prefix="/api/credits", tags=["credits"])

RATES = {
    "BASE_CALL": 500,
    "AI_FACE": 2000,
    "VOICE_EFFECT": 2500,
    "CLOUD_GPU": 5000,
}
QUALITY_MULTIPLIER = {"LOW": 1.0, "STANDARD": 1.25, "HD": 2.0}


def wallet_payload(db, user_id: str) -> dict:
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
        **{key: wallet.get(key, 0) for key in [
            "availableMilliCredits",
            "reservedMilliCredits",
            "includedMilliCredits",
            "purchasedMilliCredits",
            "lifetimePurchasedMilli",
            "lifetimeConsumedMilli",
        ]},
        "topUpAllowed": active_paid and plan.get("creditTopupsAllowed", False),
        "activePaidSubscription": active_paid,
        "nextResetAt": iso(wallet.get("includedResetAt")),
        "exhausted": wallet.get("availableMilliCredits", 0) <= 0,
        "plan": {"name": plan["name"], "monthlyCredits": plan["monthlyCredits"]},
    }


@router.get("/wallet")
def get_wallet(request: Request, user: dict = Depends(current_user)) -> dict:
    return wallet_payload(request.app.state.db, user["id"])


@router.get("/transactions")
def transactions(
    request: Request, take: int = 50, user: dict = Depends(current_user)
) -> list[dict]:
    wallet = request.app.state.db.credit_wallets.find_one({"userId": user["id"]})
    records = request.app.state.db.credit_transactions.find(
        {"walletId": wallet["id"]}, {"_id": 0}
    ).sort("createdAt", -1).limit(max(1, min(take, 200)))
    return json_safe(list(records))


@router.get("/quote")
def quote(
    roomId: str,
    mode: str,
    quality: str,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    plan, _subscription = current_entitlement(request.app.state.db, user["id"])
    quality = quality.upper()
    if quality not in plan["allowedQualities"]:
        raise HTTPException(status_code=403, detail="Quality is not included in your plan")
    rate = math.ceil(
        RATES.get(mode.upper(), RATES["BASE_CALL"])
        * QUALITY_MULTIPLIER.get(quality, 1.0)
    )
    return {
        "roomId": roomId,
        "mode": mode.upper(),
        "quality": quality,
        "milliCreditsPerMinute": rate,
        "fiveMinuteReservationMilli": rate * 5,
    }


@router.post("/meter/reserve")
def reserve(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    key = str(body.get("idempotencyKey", ""))
    existing = db.credit_transactions.find_one({"idempotencyKey": key})
    if existing:
        return json_safe({k: v for k, v in existing.items() if k != "_id"})
    amount = int(body.get("amountMilli", 0))
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Reservation amount must be positive")
    wallet = db.credit_wallets.find_one_and_update(
        {"userId": user["id"], "availableMilliCredits": {"$gte": amount}},
        {
            "$inc": {
                "availableMilliCredits": -amount,
                "reservedMilliCredits": amount,
                "version": 1,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not wallet:
        raise HTTPException(status_code=402, detail="Insufficient credits")
    transaction = {
        "id": str(uuid.uuid4()),
        "walletId": wallet["id"],
        "userId": user["id"],
        "roomId": body.get("roomId"),
        "type": "RESERVATION",
        "amountMilli": -amount,
        "balanceAfterMilli": wallet["availableMilliCredits"],
        "source": "call-meter",
        "reason": None,
        "idempotencyKey": key,
        "createdAt": utc_now(),
    }
    db.credit_transactions.insert_one(transaction)
    return json_safe({k: v for k, v in transaction.items() if k != "_id"})


@router.post("/meter/settle")
def settle(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    window = str(body.get("meteringWindow", ""))
    existing = db.usage_minutes.find_one({"meteringWindow": window})
    if existing:
        return json_safe({k: v for k, v in existing.items() if k != "_id"})
    milliseconds = int(body.get("billableMilliseconds", 0))
    rate = int(body.get("milliCreditsPerMinute", 0))
    charge = max(1, math.ceil(milliseconds * rate / 60_000))
    wallet = db.credit_wallets.find_one_and_update(
        {"userId": user["id"], "reservedMilliCredits": {"$gte": charge}},
        {
            "$inc": {
                "reservedMilliCredits": -charge,
                "lifetimeConsumedMilli": charge,
                "version": 1,
            },
            "$set": {"updatedAt": utc_now()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not wallet:
        raise HTTPException(status_code=402, detail="Reserved credits are exhausted")
    now = utc_now()
    usage = {
        "id": str(uuid.uuid4()),
        "walletId": wallet["id"],
        "roomId": body.get("roomId"),
        "mode": body.get("mode", "AI_FACE"),
        "quality": body.get("quality", "STANDARD"),
        "billableMilliseconds": milliseconds,
        "milliCreditsPerMinute": rate,
        "milliCreditsCharged": charge,
        "meteringWindow": window,
        "startedAt": now,
        "endedAt": now,
        "createdAt": now,
    }
    db.usage_minutes.insert_one(usage)
    db.credit_transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "walletId": wallet["id"],
            "userId": user["id"],
            "roomId": body.get("roomId"),
            "type": "USAGE",
            "amountMilli": -charge,
            "balanceAfterMilli": wallet["availableMilliCredits"],
            "source": "call-meter",
            "reason": f"{usage['mode']} {usage['quality']}",
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
    key = str(body.get("idempotencyKey", ""))
    existing = db.credit_transactions.find_one({"idempotencyKey": key})
    if existing:
        return json_safe({k: v for k, v in existing.items() if k != "_id"})
    amount = int(body.get("amountMilli", 0))
    wallet = db.credit_wallets.find_one_and_update(
        {"userId": user["id"], "reservedMilliCredits": {"$gte": amount}},
        {
            "$inc": {
                "availableMilliCredits": amount,
                "reservedMilliCredits": -amount,
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
        "roomId": body.get("roomId"),
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
