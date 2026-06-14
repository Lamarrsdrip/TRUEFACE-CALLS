from __future__ import annotations

import csv
import io
import os
import re
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pymongo import ReturnDocument

from ..audit import audit
from ..billing_rules import NAIRA_CURRENCY
from ..face_storage import purge_face_profile_data
from ..manual_payments import expire_manual_payments
from ..payment_fulfillment import fulfill_payment
from ..security import current_admin, current_user, require_permission
from ..serializers import iso, json_safe, utc_now

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _identity(user: dict, admin: dict) -> tuple[str, str]:
    return user["id"], admin["id"]


@router.get("/overview")
def overview(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> dict:
    db = request.app.state.db
    expire_manual_payments(db)
    succeeded = list(
        db.payments.find({"status": {"$in": ["SUCCEEDED", "APPROVED"]}})
    )
    usage = list(db.usage_minutes.find({}))
    transactions = list(db.credit_transactions.find({}))
    return {
        "users": db.users.count_documents({"status": {"$ne": "DELETED"}}),
        "activeSubscriptions": db.subscriptions.count_documents({"status": "ACTIVE"}),
        "trialUsers": db.subscriptions.count_documents({"status": "TRIALING"}),
        "activeRooms": db.call_rooms.count_documents({"status": {"$in": ["OPEN", "ACTIVE"]}}),
        "pendingFaces": db.face_profiles.count_documents({"moderationStatus": "PENDING", "deletedAt": None}),
        "faceProfiles": db.face_profiles.count_documents({"deletedAt": None}),
        "openReports": db.abuse_reports.count_documents({"status": {"$in": ["OPEN", "INVESTIGATING"]}}),
        "pendingManualPayments": db.payments.count_documents({"provider": "MANUAL", "status": "PENDING"}),
        "revenueMinor": sum(item.get("amountMinor", 0) for item in succeeded),
        "creditsSoldMilli": sum(item.get("creditsMilli", 0) or 0 for item in succeeded),
        "aiMinutes": round(
            sum(item.get("billableMilliseconds", 0) for item in usage if item.get("mode") == "AI_FACE") / 60_000
        ),
        "creditsConsumedMilli": sum(
            -item.get("amountMilli", 0)
            for item in transactions
            if item.get("type") == "USAGE"
        ),
        "failedWebhooks": db.webhook_events.count_documents({"status": "FAILED"}),
        "systemAlerts": db.provider_health.count_documents({"status": {"$in": ["DOWN", "DEGRADED"]}}),
        "providerHealth": json_safe(
            list(db.provider_health.find({}, {"_id": 0}).sort("provider", 1))
        ),
    }


@router.get("/users")
def users(
    request: Request,
    search: Optional[str] = None,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    db = request.app.state.db
    expire_manual_payments(db)
    query = {}
    if search:
        safe_search = re.escape(search.strip()[:100])
        query = {
            "$or": [
                {"email": {"$regex": safe_search, "$options": "i"}},
                {"displayName": {"$regex": safe_search, "$options": "i"}},
            ]
        }
    result = []
    for user in db.users.find(query).sort("createdAt", -1):
        wallet = db.credit_wallets.find_one({"userId": user["id"]})
        result.append(
            {
                **json_safe(
                    {
                        key: user.get(key)
                        for key in [
                            "id",
                            "displayName",
                            "email",
                            "status",
                            "createdAt",
                            "roomCreationDisabled",
                        ]
                    }
                ),
                "creditWallet": json_safe(
                    {"availableMilliCredits": wallet.get("availableMilliCredits", 0)}
                )
                if wallet
                else None,
            }
        )
    return result


@router.get("/users/{user_id}")
def user_detail(
    user_id: str,
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> dict:
    user = request.app.state.db.users.find_one({"id": user_id}, {"_id": 0, "passwordHash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return json_safe(user)


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "users:write")
    status = str(body.get("status", ""))
    if status not in {"ACTIVE", "SUSPENDED", "DELETION_PENDING"}:
        raise HTTPException(status_code=422, detail="Invalid user status")
    request.app.state.db.users.update_one(
        {"id": user_id}, {"$set": {"status": status, "updatedAt": utc_now()}}
    )
    if status != "ACTIVE":
        request.app.state.db.sessions.update_many(
            {"userId": user_id, "revokedAt": None},
            {"$set": {"revokedAt": utc_now()}},
        )
    audit(request.app.state.db, "USER_STATUS_UPDATED", "USER", user["id"], admin["id"], user_id, after={"status": status})
    return {"id": user_id, "status": status}


@router.patch("/users/{user_id}/room-access")
def room_access(
    user_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "users:write")
    disabled = bool(body.get("disabled"))
    request.app.state.db.users.update_one(
        {"id": user_id}, {"$set": {"roomCreationDisabled": disabled, "updatedAt": utc_now()}}
    )
    audit(request.app.state.db, "ROOM_ACCESS_UPDATED", "USER", user["id"], admin["id"], user_id, after={"disabled": disabled})
    return {"id": user_id, "roomCreationDisabled": disabled}


@router.get("/subscriptions")
def subscriptions(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.subscriptions.find({}, {"_id": 0}).sort("createdAt", -1)))


@router.get("/payments")
def payments(
    request: Request,
    provider: Optional[str] = None,
    status: Optional[str] = None,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    db = request.app.state.db
    expire_manual_payments(db)
    query = {}
    if provider:
        query["provider"] = provider.upper()
    if status:
        query["status"] = status.upper()
    result = []
    for payment in db.payments.find(query).sort("createdAt", -1):
        owner = db.users.find_one({"id": payment["userId"]})
        result.append(
            {
                **json_safe({k: v for k, v in payment.items() if k != "_id"}),
                "user": {
                    "email": owner["email"],
                    "displayName": owner["displayName"],
                },
            }
        )
    return result


@router.post("/payments/{payment_id}/decision")
def decide_payment(
    payment_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "billing:write")
    db = request.app.state.db
    payment = db.payments.find_one({"id": payment_id, "provider": "MANUAL"})
    if not payment:
        raise HTTPException(status_code=404, detail="Manual payment not found")
    if payment["status"] not in {"PENDING", "EXPIRED"}:
        if payment["status"] in {"SUCCEEDED", "APPROVED"}:
            fulfill_payment(db, payment, actor_admin_id=admin["id"])
        return {"id": payment_id, "status": payment["status"], "idempotent": True}
    decision = str(body.get("decision", ""))
    if decision not in {"APPROVE", "REJECT"}:
        raise HTTPException(status_code=422, detail="Invalid payment decision")
    now = utc_now()
    next_status = "APPROVED" if decision == "APPROVE" else "REJECTED"
    claimed = db.payments.find_one_and_update(
        {"id": payment_id, "status": {"$in": ["PENDING", "EXPIRED"]}},
        {
            "$set": {
                "status": next_status,
                "reviewedAt": now,
                "reviewedByAdminId": admin["id"],
                "adminNotes": body.get("reason"),
                "updatedAt": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        current = db.payments.find_one({"id": payment_id})
        if current and current.get("status") in {"SUCCEEDED", "APPROVED"}:
            fulfill_payment(db, current, actor_admin_id=admin["id"])
        return {
            "id": payment_id,
            "status": current.get("status") if current else "UNKNOWN",
            "idempotent": True,
        }
    if decision == "APPROVE":
        fulfill_payment(db, claimed, actor_admin_id=admin["id"])
    metadata = payment.get("metadata") or {}
    audit(
        db,
        f"MANUAL_PAYMENT_{decision}D",
        "PAYMENT",
        user["id"],
        admin["id"],
        payment_id,
        after={
            "status": next_status,
            "amountMinor": payment["amountMinor"],
            "currency": NAIRA_CURRENCY,
            "planId": metadata.get("planId"),
            "creditPackKey": metadata.get("creditPackKey"),
            "paymentReference": payment.get("paymentReference"),
            "reviewedAt": iso(now),
            "reason": body.get("reason"),
        },
    )
    return {"id": payment_id, "status": next_status}


@router.get("/payments/{payment_id}/proof")
def payment_proof(
    payment_id: str,
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> dict:
    payment = request.app.state.db.payments.find_one({"id": payment_id})
    object_key = payment.get("proofObjectKey") if payment else None
    if not object_key:
        raise HTTPException(status_code=404, detail="Payment proof not found")
    expires = int((utc_now() + timedelta(minutes=10)).timestamp())
    return {"url": f"/api/private-files/{object_key}?token={request.app.state.sign_download(object_key, expires)}"}


@router.get("/calls")
def calls(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.call_rooms.find({}, {"_id": 0, "passwordHash": 0}).sort("createdAt", -1)))


@router.post("/calls/{room_id}/end")
def admin_end_call(
    room_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "calls:write")
    result = request.app.state.db.call_rooms.update_one(
        {"id": room_id}, {"$set": {"status": "ENDED", "endedAt": utc_now(), "updatedAt": utc_now()}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Call room not found")
    audit(request.app.state.db, "ADMIN_ENDED_CALL", "CALL_ROOM", user["id"], admin["id"], room_id, after={"reason": body.get("reason")})
    return {"ended": True}


@router.get("/usage")
def usage(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.usage_minutes.find({}, {"_id": 0}).sort("createdAt", -1).limit(500)))


@router.get("/faces/moderation")
def face_queue(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    db = request.app.state.db
    result = []
    for face in db.face_profiles.find({"deletedAt": None}).sort("createdAt", -1):
        owner = db.users.find_one({"id": face["userId"]})
        result.append({**json_safe({k: v for k, v in face.items() if k != "_id"}), "user": {"email": owner["email"], "displayName": owner["displayName"]}})
    return result


@router.post("/faces/{face_id}/decision")
def decide_face(
    face_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "faces:write")
    status = str(body.get("status", ""))
    if status not in {"APPROVED", "REJECTED", "QUARANTINED"}:
        raise HTTPException(status_code=422, detail="Invalid moderation status")
    now = utc_now()
    result = request.app.state.db.face_profiles.update_one(
        {"id": face_id}, {"$set": {"moderationStatus": status, "updatedAt": now}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Face profile not found")
    request.app.state.db.face_moderation_events.insert_one(
        {
            "id": str(uuid.uuid4()),
            "faceProfileId": face_id,
            "moderatorId": admin["id"],
            "status": status,
            "reasonCodes": body.get("reasonCodes", []),
            "note": body.get("note"),
            "createdAt": now,
        }
    )
    audit(request.app.state.db, "FACE_MODERATED", "FACE_PROFILE", user["id"], admin["id"], face_id, after={"status": status})
    return {"id": face_id, "moderationStatus": status}


@router.post("/faces/{face_id}/delete")
def admin_delete_face(
    face_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "faces:write")
    profile = request.app.state.db.face_profiles.find_one(
        {"id": face_id, "deletedAt": None}
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Face profile not found")
    purge_face_profile_data(request.app.state.db, profile)
    now = utc_now()
    request.app.state.db.face_profiles.update_one(
        {"id": face_id}, {"$set": {"active": False, "deletedAt": now, "updatedAt": now}}
    )
    request.app.state.db.consent_logs.update_many(
        {"faceProfileId": face_id, "revokedAt": None}, {"$set": {"revokedAt": now}}
    )
    audit(request.app.state.db, "ADMIN_DELETED_FACE", "FACE_PROFILE", user["id"], admin["id"], face_id, after={"reason": body.get("reason")})
    return {"deleted": True}


@router.get("/abuse-reports")
def reports(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.abuse_reports.find({}, {"_id": 0}).sort("createdAt", -1)))


@router.patch("/abuse-reports/{report_id}")
def update_report(
    report_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "reports:write")
    status = str(body.get("status", ""))
    if status not in {"OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"}:
        raise HTTPException(status_code=422, detail="Invalid abuse-report status")
    result = request.app.state.db.abuse_reports.update_one(
        {"id": report_id}, {"$set": {"status": status, "resolution": body.get("resolution"), "assignedAdminId": admin["id"], "updatedAt": utc_now()}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Abuse report not found")
    audit(request.app.state.db, "ABUSE_REPORT_UPDATED", "ABUSE_REPORT", user["id"], admin["id"], report_id, after={"status": status})
    return {"id": report_id, "status": status}


@router.post("/credits/adjust")
def adjust_credits(
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "credits:write")
    amount = int(body.get("amountMilli", 0))
    reason = str(body.get("reason", "")).strip()
    if amount == 0 or len(reason) < 5:
        raise HTTPException(status_code=422, detail="Amount and reason are required")
    db = request.app.state.db
    wallet = db.credit_wallets.find_one({"userId": body.get("userId")})
    if not wallet or wallet.get("availableMilliCredits", 0) + amount < 0:
        raise HTTPException(status_code=409, detail="Credit adjustment is invalid")
    db.credit_wallets.update_one(
        {"id": wallet["id"]}, {"$inc": {"availableMilliCredits": amount, "version": 1}, "$set": {"updatedAt": utc_now()}}
    )
    wallet = db.credit_wallets.find_one({"id": wallet["id"]})
    transaction = {
        "id": str(uuid.uuid4()),
        "walletId": wallet["id"],
        "userId": body.get("userId"),
        "actorAdminId": admin["id"],
        "type": "ADMIN_ADJUSTMENT",
        "amountMilli": amount,
        "balanceAfterMilli": wallet["availableMilliCredits"],
        "source": "admin",
        "reason": reason,
        "idempotencyKey": f"admin:{admin['id']}:{uuid.uuid4()}",
        "createdAt": utc_now(),
    }
    db.credit_transactions.insert_one(transaction)
    audit(db, "CREDITS_ADJUSTED", "CREDIT_WALLET", user["id"], admin["id"], wallet["id"], after={"amountMilli": amount, "reason": reason})
    return json_safe({k: v for k, v in transaction.items() if k != "_id"})


@router.get("/plans")
def admin_plans(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.plans.find({}, {"_id": 0}).sort("sortOrder", 1)))


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "plans:write")
    allowed = {
        "name", "description", "priceMonthlyMinor", "monthlyCredits",
        "maxFaceProfiles", "maxImagesPerProfile", "maxParticipants",
        "maxCallMinutes", "maxGroupCalls", "allowedQualities",
        "watermarkRequired", "creditTopupsAllowed", "creditResetDays",
        "groupCalls", "voiceEffects", "cloudGpu", "enabled",
    }
    changes = {key: value for key, value in body.items() if key in allowed}
    changes["currency"] = NAIRA_CURRENCY
    changes["updatedAt"] = utc_now()
    result = request.app.state.db.plans.update_one({"id": plan_id}, {"$set": changes})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Plan not found")
    audit(request.app.state.db, "PLAN_UPDATED", "PLAN", user["id"], admin["id"], plan_id, after=changes)
    return json_safe(request.app.state.db.plans.find_one({"id": plan_id}, {"_id": 0}))


@router.get("/settings")
def settings(
    request: Request,
    namespace: Optional[str] = None,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    query = {"namespace": namespace} if namespace else {"namespace": {"$ne": "provider"}}
    return json_safe(
        list(
            request.app.state.db.app_settings.find(
                query,
                {"_id": 0, "encryptedValue": 0},
            ).sort([("namespace", 1), ("key", 1)])
        )
    )


@router.put("/settings/{namespace}/{key}")
def set_setting(
    namespace: str,
    key: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "settings:write")
    if namespace == "provider":
        raise HTTPException(
            status_code=403,
            detail="Use Admin > Providers so credentials remain encrypted",
        )
    value = body.get("value", {})
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="Setting value must be an object")
    now = utc_now()
    request.app.state.db.app_settings.update_one(
        {"namespace": namespace, "key": key},
        {
            "$set": {"publicValue": value, "updatedById": user["id"], "updatedAt": now},
            "$setOnInsert": {"id": str(uuid.uuid4()), "namespace": namespace, "key": key, "version": 1, "createdAt": now},
        },
        upsert=True,
    )
    audit(request.app.state.db, "APP_SETTING_UPDATED", "APP_SETTING", user["id"], admin["id"], f"{namespace}/{key}", after={"keys": sorted(value.keys())})
    return {"namespace": namespace, "key": key, "value": value}


@router.get("/deployment")
def deployment(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> dict:
    required = [
        "MONGO_URL",
        "DB_NAME",
        "AUTH_SECRET",
        "SETTINGS_MASTER_KEY",
        "APP_URL",
        "BOOTSTRAP_ADMIN_EMAIL",
        "BOOTSTRAP_ADMIN_PASSWORD",
    ]
    providers = []
    for item in request.app.state.db.provider_health.find({}, {"_id": 0}):
        setting = request.app.state.db.app_settings.find_one(
            {"namespace": "provider", "key": item["provider"]}
        ) or {}
        providers.append(
            {
                "provider": item["provider"],
                "status": item.get("status", "UNCONFIGURED"),
                "checkedAt": iso(item.get("checkedAt")),
                "configuredKeys": sorted(
                    set((setting.get("publicValue") or {}).keys())
                    | set((setting.get("encryptedValue") or {}).keys())
                ),
            }
        )
    return {
        "target": "Emergent native",
        "nodeEnvironment": os.getenv("NODE_ENV", "production"),
        "buildCommand": "cd frontend && npm install && npm run build",
        "startCommand": "uvicorn server:app --host 0.0.0.0 --port 8001",
        "environment": [{"key": key, "configured": bool(os.getenv(key))} for key in required],
        "providers": providers,
    }


@router.post("/notifications/broadcast")
def broadcast(
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "settings:write")
    notification = {
        "id": str(uuid.uuid4()),
        "userId": None,
        "audience": body.get("audience", "ALL"),
        "channel": "IN_APP",
        "title": str(body.get("title", ""))[:120],
        "body": str(body.get("body", ""))[:2000],
        "data": {},
        "deliveredAt": utc_now(),
        "readAt": None,
        "createdAt": utc_now(),
    }
    request.app.state.db.notifications.insert_one(notification)
    audit(request.app.state.db, "NOTIFICATION_BROADCAST", "NOTIFICATION", user["id"], admin["id"], notification["id"], after={"audience": notification["audience"]})
    return json_safe({k: v for k, v in notification.items() if k != "_id"})


@router.get("/audit-logs")
def audit_logs(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    return json_safe(list(request.app.state.db.audit_logs.find({}, {"_id": 0}).sort("createdAt", -1).limit(500)))


@router.get("/audit-logs/export")
def audit_export(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> Response:
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["createdAt", "action", "targetType", "targetId", "actorAdminId"])
    for item in request.app.state.db.audit_logs.find({}).sort("createdAt", -1):
        writer.writerow([iso(item.get("createdAt")), item.get("action"), item.get("targetType"), item.get("targetId"), item.get("actorAdminId")])
    return Response(
        content=stream.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": "attachment; filename=trueface-audit.csv"},
    )
