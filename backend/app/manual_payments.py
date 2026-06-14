from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import HTTPException

from .billing_rules import naira_minor_from_config
from .serializers import utc_now


def generate_payment_reference(db) -> str:
    for _attempt in range(10):
        reference = f"TFC-{secrets.token_hex(4).upper()}"
        if not db.payments.find_one({"paymentReference": reference}):
            return reference
    raise HTTPException(
        status_code=503,
        detail="Could not create a unique payment reference. Please try again.",
    )


def manual_bank_details(config: dict[str, str]) -> dict:
    enabled = config.get("enabled", "false").lower() == "true"
    required = ("bankName", "accountName", "accountNumber")
    if not enabled or any(not config.get(key) for key in required):
        raise HTTPException(
            status_code=503,
            detail="Manual bank transfer is not fully configured",
        )
    expiry_minutes = _bounded_int(config.get("expiryMinutes"), 30, 5, 1_440)
    return {
        "bankName": config["bankName"],
        "accountName": config["accountName"],
        "accountNumber": config["accountNumber"],
        "instructions": config.get("instructions", ""),
        "currency": "NGN",
        "proofRequired": config.get("proofRequired", "false").lower() == "true",
        "expiryMinutes": expiry_minutes,
        "minimumMinor": naira_minor_from_config(
            config.get("minimumAmount"),
            int(config.get("minimumMinor", 0) or 0),
        ),
        "maximumMinor": naira_minor_from_config(
            config.get("maximumAmount"),
            int(config.get("maximumMinor", 0) or 0),
        ),
    }


def enforce_manual_amount(amount_minor: int, details: dict) -> None:
    minimum = int(details.get("minimumMinor") or 0)
    maximum = int(details.get("maximumMinor") or 0)
    if minimum and amount_minor < minimum:
        raise HTTPException(
            status_code=422,
            detail="This payment is below the configured bank-transfer minimum",
        )
    if maximum and amount_minor > maximum:
        raise HTTPException(
            status_code=422,
            detail="This payment exceeds the configured bank-transfer maximum",
        )


def expire_manual_payments(db, user_id: str | None = None) -> int:
    query: dict = {
        "provider": "MANUAL",
        "status": "PENDING",
        "expiresAt": {"$lte": utc_now()},
    }
    if user_id:
        query["userId"] = user_id
    result = db.payments.update_many(
        query,
        {"$set": {"status": "EXPIRED", "expiredAt": utc_now(), "updatedAt": utc_now()}},
    )
    return result.modified_count


def payment_expiry(expiry_minutes: int):
    return utc_now() + timedelta(minutes=expiry_minutes)


def _bounded_int(value: object, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return min(maximum, max(minimum, parsed))
