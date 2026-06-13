from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Request

from .serializers import utc_now

PASSWORDS = PasswordHasher()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token(bytes_count: int = 32) -> str:
    return secrets.token_urlsafe(bytes_count)


def create_access_token(
    secret: str, user_id: str, session_id: str, is_admin: bool
) -> str:
    now = utc_now()
    return jwt.encode(
        {
            "sub": user_id,
            "sid": session_id,
            "admin": is_admin,
            "iat": now,
            "exp": now + timedelta(minutes=15),
            "jti": str(uuid.uuid4()),
        },
        secret,
        algorithm="HS256",
    )


def decode_access_token(secret: str, token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="Authentication required") from error


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return PASSWORDS.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get("tf_access")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = decode_access_token(request.app.state.settings.auth_secret, token)
    session = request.app.state.db.sessions.find_one(
        {"id": payload["sid"], "revokedAt": None}
    )
    user = request.app.state.db.users.find_one(
        {"id": payload["sub"], "status": {"$ne": "DELETED"}}
    )
    if not session or not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def current_admin(
    request: Request, user: dict[str, Any] = Depends(current_user)
) -> dict[str, Any]:
    admin = request.app.state.db.admin_users.find_one(
        {"userId": user["id"], "active": True}
    )
    if not admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return admin


def require_permission(admin: dict[str, Any], permission: str) -> None:
    permissions = admin.get("permissions", [])
    if "*" not in permissions and permission not in permissions:
        raise HTTPException(status_code=403, detail="Permission denied")
