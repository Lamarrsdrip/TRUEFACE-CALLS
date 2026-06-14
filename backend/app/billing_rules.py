from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

NAIRA_CURRENCY = "NGN"


def naira_minor_from_config(value: object, default: int) -> int:
    if value in (None, ""):
        return default
    try:
        return max(0, int(Decimal(str(value)) * 100))
    except (InvalidOperation, ValueError):
        raise HTTPException(
            status_code=422,
            detail="Bank transfer amount limits must be valid Naira amounts",
        )


def require_naira_amount(amount_minor: object) -> int:
    try:
        amount = int(amount_minor)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Payment amount is invalid")
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be positive")
    return amount
