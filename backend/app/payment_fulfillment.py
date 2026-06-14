from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .serializers import utc_now


def fulfill_payment(
    db,
    payment: dict,
    *,
    actor_admin_id: str | None = None,
) -> None:
    key = f"payment-fulfillment:{payment['id']}"
    if db.credit_transactions.find_one({"idempotencyKey": key}):
        return
    wallet = db.credit_wallets.find_one({"userId": payment["userId"]})
    if not wallet:
        raise HTTPException(status_code=409, detail="Payment wallet no longer exists")
    metadata = payment.get("metadata") or {}
    now = utc_now()
    if payment["type"] == "SUBSCRIPTION":
        plan = db.plans.find_one({"id": metadata.get("planId")})
        if not plan:
            raise HTTPException(status_code=409, detail="Payment plan no longer exists")
        subscription_id = f"payment:{payment['id']}"
        db.subscriptions.update_many(
            {
                "userId": payment["userId"],
                "id": {"$ne": subscription_id},
                "status": {"$in": ["TRIALING", "ACTIVE"]},
            },
            {"$set": {"status": "CANCELED", "canceledAt": now, "updatedAt": now}},
        )
        db.subscriptions.update_one(
            {"id": subscription_id},
            {
                "$set": {
                    "planId": plan["id"],
                    "provider": payment["provider"],
                    "status": "ACTIVE",
                    "currentPeriodStart": now,
                    "currentPeriodEnd": now
                    + timedelta(days=plan["creditResetDays"]),
                    "updatedAt": now,
                },
                "$setOnInsert": {
                    "id": subscription_id,
                    "userId": payment["userId"],
                    "createdAt": now,
                },
            },
            upsert=True,
        )
        grant = int(plan["monthlyCredits"])
        current_included = int(wallet.get("includedMilliCredits", 0))
        updated_wallet = db.credit_wallets.find_one_and_update(
            {
                "id": wallet["id"],
                "fulfilledPaymentIds": {"$ne": payment["id"]},
            },
            {
                "$inc": {
                    "availableMilliCredits": grant - current_included,
                    "version": 1,
                },
                "$set": {
                    "includedMilliCredits": grant,
                    "includedResetAt": now + timedelta(days=plan["creditResetDays"]),
                    "updatedAt": now,
                },
                "$addToSet": {"fulfilledPaymentIds": payment["id"]},
            },
            return_document=ReturnDocument.AFTER,
        )
        transaction_type = "SUBSCRIPTION_GRANT"
        amount = grant
    else:
        amount = int(metadata.get("creditsMilli") or payment.get("creditsMilli") or 0)
        if amount <= 0:
            raise HTTPException(status_code=409, detail="Payment credit amount is invalid")
        updated_wallet = db.credit_wallets.find_one_and_update(
            {
                "id": wallet["id"],
                "fulfilledPaymentIds": {"$ne": payment["id"]},
            },
            {
                "$inc": {
                    "availableMilliCredits": amount,
                    "purchasedMilliCredits": amount,
                    "lifetimePurchasedMilli": amount,
                    "version": 1,
                },
                "$set": {"updatedAt": now},
                "$addToSet": {"fulfilledPaymentIds": payment["id"]},
            },
            return_document=ReturnDocument.AFTER,
        )
        transaction_type = "PURCHASE"
    wallet = updated_wallet or db.credit_wallets.find_one({"id": wallet["id"]})
    if payment["id"] not in wallet.get("fulfilledPaymentIds", []):
        raise HTTPException(status_code=409, detail="Payment fulfillment could not be claimed")
    try:
        db.credit_transactions.insert_one(
            {
                "id": str(uuid.uuid4()),
                "walletId": wallet["id"],
                "userId": payment["userId"],
                "paymentId": payment["id"],
                "actorAdminId": actor_admin_id,
                "type": transaction_type,
                "amountMilli": amount,
                "balanceAfterMilli": wallet["availableMilliCredits"],
                "source": (
                    "manual-payment"
                    if payment["provider"] == "MANUAL"
                    else f"{payment['provider'].lower()}-webhook"
                ),
                "reason": (
                    "Administrator approved bank transfer"
                    if payment["provider"] == "MANUAL"
                    else "Verified payment provider webhook"
                ),
                "idempotencyKey": key,
                "createdAt": now,
            }
        )
    except DuplicateKeyError:
        return
