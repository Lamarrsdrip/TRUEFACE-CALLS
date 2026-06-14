from __future__ import annotations

import logging
import re
import uuid
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from ..email_service import send_email
from ..entitlements import current_entitlement
from ..face_storage import purge_face_profile_data
from ..provider_policy import CONFIGURED, provider_configuration_status
from ..routers.providers import provider_values
from ..security import (
    PASSWORDS,
    create_access_token,
    current_admin,
    current_user,
    hash_token,
    new_token,
    verify_password,
)
from ..serializers import iso, json_safe, utc_now

router = APIRouter(prefix="/api/auth", tags=["auth"])
LOGGER = logging.getLogger("trueface.auth")


class SignupBody(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=12, max_length=128)
    displayName: str = Field(min_length=2, max_length=80)


class LoginBody(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class ProfileBody(BaseModel):
    displayName: Optional[str] = Field(default=None, min_length=2, max_length=80)
    gender: Optional[Literal["MALE", "FEMALE", "UNSET"]] = None
    voicePreference: Optional[
        Literal["MALE_TONE", "FEMALE_TONE", "ORIGINAL"]
    ] = None


def _set_cookies(response: Response, access: str, refresh: str, secure: bool) -> None:
    common = {"httponly": True, "secure": secure, "samesite": "lax", "path": "/"}
    response.set_cookie("tf_access", access, max_age=900, **common)
    response.set_cookie("tf_refresh", refresh, max_age=2_592_000, **common)


def _start_session(request: Request, response: Response, user: dict) -> None:
    now = utc_now()
    refresh = new_token()
    session_id = str(uuid.uuid4())
    admin = request.app.state.db.admin_users.find_one(
        {"userId": user["id"], "active": True}
    )
    request.app.state.db.sessions.insert_one(
        {
            "id": session_id,
            "userId": user["id"],
            "refreshTokenHash": hash_token(refresh),
            "userAgent": request.headers.get("user-agent", "")[:512],
            "expiresAt": now + timedelta(days=30),
            "revokedAt": None,
            "createdAt": now,
        }
    )
    access = create_access_token(
        request.app.state.settings.auth_secret,
        user["id"],
        session_id,
        bool(admin),
    )
    secure = request.app.state.settings.app_url.startswith("https://")
    _set_cookies(response, access, refresh, secure)


def _safe_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["displayName"],
        "status": user["status"],
        "emailVerifiedAt": iso(user.get("emailVerifiedAt")),
        "locale": user.get("locale", "en"),
        "timezone": user.get("timezone", "UTC"),
        "gender": user.get("gender", "UNSET"),
        "voicePreference": user.get("voicePreference", "ORIGINAL"),
        "faceFeaturesDisabled": bool(user.get("faceFeaturesDisabled", False)),
        "voiceFeaturesDisabled": bool(user.get("voiceFeaturesDisabled", False)),
        "createdAt": iso(user.get("createdAt")),
    }


def _valid_password(password: str) -> bool:
    return bool(
        len(password) >= 12
        and re.search(r"[a-z]", password)
        and re.search(r"[A-Z]", password)
        and re.search(r"\d", password)
    )


def _deliver_auth_email(
    request: Request,
    recipient: str,
    subject: str,
    text: str,
) -> bool:
    values = provider_values(request, "email")
    if provider_configuration_status("email", values) != CONFIGURED:
        return False
    try:
        send_email(values, recipient, subject, text)
        return True
    except Exception:
        LOGGER.exception("Authentication email delivery failed recipient=%s", recipient)
        return False


@router.get("/csrf")
def csrf(request: Request, response: Response) -> dict:
    token = new_token(24)
    response.set_cookie(
        "tf_csrf",
        token,
        httponly=False,
        secure=request.app.state.settings.app_url.startswith("https://"),
        samesite="lax",
        path="/",
    )
    return {"csrfToken": token}


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(body: SignupBody, request: Request, response: Response) -> dict:
    if not _valid_password(body.password):
        raise HTTPException(
            status_code=422,
            detail="Password must include uppercase, lowercase, and a number",
        )
    db = request.app.state.db
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    if db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email is already registered")
    now = utc_now()
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "passwordHash": PASSWORDS.hash(body.password),
        "displayName": body.displayName.strip(),
        "status": "ACTIVE",
        "emailVerifiedAt": None,
        "locale": "en",
        "timezone": "UTC",
        "roomCreationDisabled": False,
        "gender": "UNSET",
        "voicePreference": "ORIGINAL",
        "faceFeaturesDisabled": False,
        "voiceFeaturesDisabled": False,
        "createdAt": now,
        "updatedAt": now,
    }
    db.users.insert_one(user)
    plan = db.plans.find_one({"key": "trial"})
    if not plan:
        from ..seed import seed_database

        seed_database(db)
        plan = db.plans.find_one({"key": "trial"})
    db.subscriptions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "planId": plan["id"],
            "provider": "MANUAL",
            "status": "TRIALING",
            "currentPeriodStart": now,
            "currentPeriodEnd": now + timedelta(days=5),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    db.credit_wallets.insert_one(
        {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "availableMilliCredits": plan["monthlyCredits"],
            "reservedMilliCredits": 0,
            "includedMilliCredits": plan["monthlyCredits"],
            "purchasedMilliCredits": 0,
            "reservedIncludedMilli": 0,
            "reservedPurchasedMilli": 0,
            "includedResetAt": now + timedelta(days=plan["creditResetDays"]),
            "lifetimePurchasedMilli": 0,
            "lifetimeConsumedMilli": 0,
            "version": 0,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    verification = new_token()
    db.auth_tokens.insert_one(
        {
            "id": str(uuid.uuid4()),
            "userId": user["id"],
            "type": "EMAIL_VERIFICATION",
            "tokenHash": hash_token(verification),
            "expiresAt": now + timedelta(days=1),
            "usedAt": None,
            "createdAt": now,
        }
    )
    verification_url = (
        f"{request.app.state.settings.app_url}/verify-email?token={verification}"
    )
    email_sent = _deliver_auth_email(
        request,
        email,
        "Verify your TrueFace Calls email",
        (
            "Verify your email address to finish setting up TrueFace Calls:\n\n"
            f"{verification_url}\n\n"
            "This link expires in 24 hours."
        ),
    )
    _start_session(request, response, user)
    return {
        "user": _safe_user(user),
        "verification": {
            "emailSent": email_sent,
            **(
                {"developmentToken": verification}
                if request.app.state.settings.app_url.startswith("http://localhost")
                else {}
            ),
        },
    }


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response) -> dict:
    user = request.app.state.db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(user["passwordHash"], body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user["status"] != "ACTIVE":
        raise HTTPException(status_code=403, detail="Account is not active")
    request.app.state.db.users.update_one(
        {"id": user["id"]}, {"$set": {"lastLoginAt": utc_now()}}
    )
    _start_session(request, response, user)
    return {"user": _safe_user(user)}


@router.post("/admin-login")
def admin_login(body: LoginBody, request: Request, response: Response) -> dict:
    user = request.app.state.db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(user["passwordHash"], body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user["status"] != "ACTIVE":
        raise HTTPException(status_code=403, detail="Account is not active")
    admin = request.app.state.db.admin_users.find_one(
        {"userId": user["id"], "active": True}
    )
    if not admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    _start_session(request, response, user)
    return {
        "user": _safe_user(user),
        "admin": {
            "id": admin["id"],
            "role": admin["role"],
            "permissions": admin["permissions"],
            "mfaRequired": admin.get("mfaRequired", True),
            "mfaEnabled": admin.get("mfaEnabled", False),
        },
    }


@router.get("/session")
def session(
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    admin = request.app.state.db.admin_users.find_one(
        {"userId": user["id"], "active": True}
    )
    result = _safe_user(user)
    plan, subscription = current_entitlement(request.app.state.db, user["id"])
    result["entitlements"] = {
        "planKey": plan["key"],
        "voiceEffects": bool(plan.get("voiceEffects", False)),
        "allowedQualities": plan.get("allowedQualities", ["LOW"]),
        "subscriptionStatus": subscription.get("status") if subscription else None,
    }
    faces = list(
        request.app.state.db.face_profiles.find(
            {"userId": user["id"], "deletedAt": None},
            {"moderationStatus": 1, "active": 1},
        )
    )
    if not faces:
        result["faceProfileStatus"] = "NONE"
    elif any(
        face.get("moderationStatus") == "APPROVED" and face.get("active")
        for face in faces
    ):
        result["faceProfileStatus"] = "READY"
    elif any(face.get("moderationStatus") == "PENDING" for face in faces):
        result["faceProfileStatus"] = "PENDING"
    else:
        result["faceProfileStatus"] = "ACTION_REQUIRED"
    result["admin"] = (
        {
            "id": admin["id"],
            "role": admin["role"],
            "permissions": admin["permissions"],
        }
        if admin
        else None
    )
    return result


@router.patch("/profile")
def update_profile(
    body: ProfileBody,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    changes = {
        key: value
        for key, value in body.model_dump(exclude_none=True).items()
        if key in {"displayName", "gender", "voicePreference"}
    }
    if "displayName" in changes:
        changes["displayName"] = changes["displayName"].strip()
    changes["updatedAt"] = utc_now()
    request.app.state.db.users.update_one({"id": user["id"]}, {"$set": changes})
    updated = request.app.state.db.users.find_one({"id": user["id"]})
    return _safe_user(updated)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user: dict = Depends(current_user),
) -> dict:
    token = request.cookies.get("tf_access")
    payload = request.app.state.decode_token(token)
    request.app.state.db.sessions.update_one(
        {"id": payload["sid"]}, {"$set": {"revokedAt": utc_now()}}
    )
    response.delete_cookie("tf_access", path="/")
    response.delete_cookie("tf_refresh", path="/")
    return {"loggedOut": True}


@router.post("/refresh")
def refresh(request: Request, response: Response) -> dict:
    token = request.cookies.get("tf_refresh")
    session = (
        request.app.state.db.sessions.find_one(
            {
                "refreshTokenHash": hash_token(token),
                "revokedAt": None,
                "expiresAt": {"$gt": utc_now()},
            }
        )
        if token
        else None
    )
    if not session:
        return {"refreshed": False}
    request.app.state.db.sessions.update_one(
        {"id": session["id"]}, {"$set": {"revokedAt": utc_now()}}
    )
    user = request.app.state.db.users.find_one({"id": session["userId"]})
    if not user or user.get("status") != "ACTIVE":
        response.delete_cookie("tf_access", path="/")
        response.delete_cookie("tf_refresh", path="/")
        return {"refreshed": False}
    _start_session(request, response, user)
    return {"refreshed": True, "user": _safe_user(user)}


@router.post("/verify-email")
def verify_email(body: dict, request: Request) -> dict:
    token = request.app.state.db.auth_tokens.find_one(
        {
            "tokenHash": hash_token(str(body.get("token", ""))),
            "type": "EMAIL_VERIFICATION",
            "usedAt": None,
            "expiresAt": {"$gt": utc_now()},
        }
    )
    if not token:
        raise HTTPException(status_code=400, detail="Verification token is invalid")
    now = utc_now()
    request.app.state.db.auth_tokens.update_one(
        {"id": token["id"]}, {"$set": {"usedAt": now}}
    )
    request.app.state.db.users.update_one(
        {"id": token["userId"]}, {"$set": {"emailVerifiedAt": now}}
    )
    return {"verified": True}


@router.post("/forgot-password")
def forgot_password(body: dict, request: Request) -> dict:
    user = request.app.state.db.users.find_one(
        {"email": str(body.get("email", "")).lower()}
    )
    development_token = None
    if user:
        development_token = new_token()
        request.app.state.db.auth_tokens.insert_one(
            {
                "id": str(uuid.uuid4()),
                "userId": user["id"],
                "type": "PASSWORD_RESET",
                "tokenHash": hash_token(development_token),
                "expiresAt": utc_now() + timedelta(hours=1),
                "usedAt": None,
                "createdAt": utc_now(),
            }
        )
        reset_url = (
            f"{request.app.state.settings.app_url}/reset-password"
            f"?token={development_token}"
        )
        _deliver_auth_email(
            request,
            user["email"],
            "Reset your TrueFace Calls password",
            (
                "Use this secure link to reset your password:\n\n"
                f"{reset_url}\n\n"
                "This link expires in one hour. Ignore this message if you did "
                "not request a reset."
            ),
        )
    return {
        "accepted": True,
        **(
            {"developmentToken": development_token}
            if development_token
            and request.app.state.settings.app_url.startswith("http://localhost")
            else {}
        ),
    }


@router.post("/reset-password")
def reset_password(body: dict, request: Request) -> dict:
    new_password = str(body.get("password", ""))
    if not _valid_password(new_password):
        raise HTTPException(
            status_code=422,
            detail="Password must include uppercase, lowercase, and a number",
        )
    token = request.app.state.db.auth_tokens.find_one(
        {
            "tokenHash": hash_token(str(body.get("token", ""))),
            "type": "PASSWORD_RESET",
            "usedAt": None,
            "expiresAt": {"$gt": utc_now()},
        }
    )
    if not token:
        raise HTTPException(status_code=400, detail="Reset token is invalid")
    now = utc_now()
    request.app.state.db.users.update_one(
        {"id": token["userId"]},
        {"$set": {"passwordHash": PASSWORDS.hash(new_password), "updatedAt": now}},
    )
    request.app.state.db.auth_tokens.update_one(
        {"id": token["id"]}, {"$set": {"usedAt": now}}
    )
    request.app.state.db.sessions.update_many(
        {"userId": token["userId"], "revokedAt": None},
        {"$set": {"revokedAt": now}},
    )
    return {"reset": True}


@router.get("/account/export")
def account_export(
    request: Request, user: dict = Depends(current_user)
) -> dict:
    db = request.app.state.db
    return json_safe(
        {
            "user": _safe_user(user),
            "faces": list(db.face_profiles.find({"userId": user["id"]}, {"_id": 0})),
            "rooms": list(db.call_rooms.find({"hostId": user["id"]}, {"_id": 0})),
            "payments": list(db.payments.find({"userId": user["id"]}, {"_id": 0})),
            "creditTransactions": list(
                db.credit_transactions.find({"userId": user["id"]}, {"_id": 0})
            ),
        }
    )


@router.delete("/account")
def delete_account(
    body: dict,
    request: Request,
    response: Response,
    user: dict = Depends(current_user),
) -> dict:
    if body.get("confirmation") != "DELETE":
        raise HTTPException(status_code=400, detail='Type "DELETE" to confirm')
    db = request.app.state.db
    now = utc_now()
    for profile in db.face_profiles.find(
        {"userId": user["id"], "deletedAt": None}
    ):
        purge_face_profile_data(db, profile)
        db.face_profiles.update_one(
            {"id": profile["id"]},
            {
                "$set": {
                    "active": False,
                    "consentRevokedAt": now,
                    "deletedAt": now,
                    "updatedAt": now,
                }
            },
        )
        db.consent_logs.update_many(
            {"faceProfileId": profile["id"], "revokedAt": None},
            {"$set": {"revokedAt": now}},
        )
    scheduled = utc_now() + timedelta(days=7)
    db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "status": "DELETION_PENDING",
                "deletionScheduledAt": scheduled,
                "updatedAt": now,
            }
        },
    )
    db.sessions.update_many(
        {"userId": user["id"], "revokedAt": None},
        {"$set": {"revokedAt": now}},
    )
    response.delete_cookie("tf_access", path="/")
    response.delete_cookie("tf_refresh", path="/")
    return {"deletionScheduledAt": iso(scheduled)}
