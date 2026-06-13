from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from ..security import current_user
from ..serializers import json_safe, utc_now

router = APIRouter(prefix="/api", tags=["safety"])


@router.post("/abuse-reports")
def report_abuse(
    body: dict, request: Request, user: dict = Depends(current_user)
) -> dict:
    category = str(body.get("category", "")).strip()
    description = str(body.get("description", "")).strip()
    if not category or len(description) < 5:
        raise HTTPException(status_code=422, detail="Category and description are required")
    report = {
        "id": str(uuid.uuid4()),
        "reporterId": user["id"],
        "reportedUserId": body.get("reportedUserId"),
        "roomId": body.get("roomId"),
        "faceProfileId": body.get("faceProfileId"),
        "category": category,
        "description": description,
        "evidenceObjectKey": body.get("evidenceObjectKey"),
        "status": "OPEN",
        "resolution": None,
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
    }
    request.app.state.db.abuse_reports.insert_one(report)
    return json_safe({k: v for k, v in report.items() if k != "_id"})


@router.get("/me/blocked-users")
def blocked_users(request: Request, user: dict = Depends(current_user)) -> list[dict]:
    result = []
    for block in request.app.state.db.blocked_users.find({"blockerId": user["id"]}):
        blocked = request.app.state.db.users.find_one({"id": block["blockedId"]})
        result.append(
            {
                "id": block["id"],
                "reason": block.get("reason"),
                "createdAt": block["createdAt"],
                "blocked": {
                    "id": blocked["id"],
                    "displayName": blocked["displayName"],
                    "email": blocked["email"],
                }
                if blocked
                else None,
            }
        )
    return json_safe(result)


@router.post("/me/blocked-users/{blocked_id}")
def block_user(
    blocked_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    if blocked_id == user["id"]:
        raise HTTPException(status_code=422, detail="You cannot block yourself")
    if not request.app.state.db.users.find_one({"id": blocked_id}):
        raise HTTPException(status_code=404, detail="User not found")
    now = utc_now()
    request.app.state.db.blocked_users.update_one(
        {"blockerId": user["id"], "blockedId": blocked_id},
        {
            "$set": {"reason": body.get("reason"), "updatedAt": now},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "blockerId": user["id"],
                "blockedId": blocked_id,
                "createdAt": now,
            },
        },
        upsert=True,
    )
    return {"blocked": True}


@router.delete("/me/blocked-users/{blocked_id}")
def unblock_user(
    blocked_id: str, request: Request, user: dict = Depends(current_user)
) -> dict:
    request.app.state.db.blocked_users.delete_one(
        {"blockerId": user["id"], "blockedId": blocked_id}
    )
    return {"blocked": False}
