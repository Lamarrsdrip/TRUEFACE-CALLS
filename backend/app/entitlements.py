from __future__ import annotations

from fastapi import HTTPException

from .serializers import utc_now


def current_entitlement(db, user_id: str) -> tuple[dict, dict | None]:
    subscription = db.subscriptions.find_one(
        {
            "userId": user_id,
            "status": {"$in": ["TRIALING", "ACTIVE"]},
            "$or": [
                {"currentPeriodEnd": None},
                {"currentPeriodEnd": {"$gt": utc_now()}},
            ],
        },
        sort=[("createdAt", -1)],
    )
    if not subscription:
        plan = db.plans.find_one({"key": "trial"})
        if not plan:
            raise HTTPException(status_code=503, detail="Plans are not configured")
        return plan, None
    plan = db.plans.find_one({"id": subscription["planId"]})
    if not plan:
        raise HTTPException(status_code=503, detail="Subscription plan is missing")
    return plan, subscription


def require_paid_subscription(db, user_id: str) -> tuple[dict, dict]:
    plan, subscription = current_entitlement(db, user_id)
    if (
        not subscription
        or subscription["status"] != "ACTIVE"
        or plan["key"] == "trial"
        or plan["priceMonthlyMinor"] <= 0
    ):
        raise HTTPException(
            status_code=403,
            detail="An active paid subscription is required to buy credits",
        )
    return plan, subscription
