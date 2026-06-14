from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ..security import current_user
from ..serializers import json_safe, utc_now

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def notifications(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    db = request.app.state.db
    records = list(db.notifications.find(
        {
            "$or": [
                {"userId": user["id"]},
                {"userId": None, "audience": {"$in": ["ALL", "USERS"]}},
            ]
        },
        {"_id": 0},
    ).sort("createdAt", -1).limit(100))
    reads = {
        item["notificationId"]: item.get("readAt")
        for item in db.notification_reads.find(
            {
                "userId": user["id"],
                "notificationId": {"$in": [item["id"] for item in records]},
            }
        )
    }
    return json_safe(
        [
            {
                **item,
                "readAt": reads.get(item["id"], item.get("readAt")),
            }
            for item in records
        ]
    )


@router.patch("/{notification_id}/read")
def read_notification(
    notification_id: str,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    db = request.app.state.db
    notification = db.notifications.find_one(
        {"id": notification_id, "userId": {"$in": [user["id"], None]}}
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    now = utc_now()
    db.notification_reads.update_one(
        {"notificationId": notification_id, "userId": user["id"]},
        {
            "$set": {"readAt": now, "updatedAt": now},
            "$setOnInsert": {
                "notificationId": notification_id,
                "userId": user["id"],
                "createdAt": now,
            },
        },
        upsert=True,
    )
    return {"read": True}
