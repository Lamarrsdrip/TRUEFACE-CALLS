from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ..security import current_user
from ..serializers import json_safe, utc_now

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def notifications(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    records = request.app.state.db.notifications.find(
        {
            "$or": [
                {"userId": user["id"]},
                {"userId": None, "audience": {"$in": ["ALL", "USERS"]}},
            ]
        },
        {"_id": 0},
    ).sort("createdAt", -1).limit(100)
    return json_safe(list(records))


@router.patch("/{notification_id}/read")
def read_notification(
    notification_id: str,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    result = request.app.state.db.notifications.update_one(
        {"id": notification_id, "userId": {"$in": [user["id"], None]}},
        {"$set": {"readAt": utc_now()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"read": True}
