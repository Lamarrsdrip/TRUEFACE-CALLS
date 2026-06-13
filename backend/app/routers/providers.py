from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from ..audit import audit
from ..security import current_admin, current_user, require_permission
from ..serializers import iso, utc_now

router = APIRouter(prefix="/api/admin/providers", tags=["providers"])

PROVIDER_FIELDS = {
    "livekit": {"secret": {"apiKey", "apiSecret"}, "required": {"url", "apiKey", "apiSecret"}},
    "storage": {"secret": {"accessKey", "secretAccessKey"}, "required": set()},
    "stripe": {"secret": {"secretKey", "webhookSecret"}, "required": {"secretKey"}},
    "paystack": {"secret": {"secretKey", "webhookSecret"}, "required": {"secretKey"}},
    "flutterwave": {
        "secret": {"secretKey", "encryptionKey", "webhookHash"},
        "required": {"secretKey"},
    },
    "email": {"secret": {"apiKey", "password"}, "required": set()},
    "ai": {"secret": {"apiKey"}, "required": set()},
    "gpu": {"secret": {"apiKey", "secretKey"}, "required": set()},
    "manual-bank": {"secret": set(), "required": set()},
    "monitoring": {"secret": {"dsn"}, "required": set()},
    "whatsapp": {"secret": {"token", "verifyToken"}, "required": set()},
}


def provider_values(request: Request, provider: str) -> dict[str, str]:
    record = request.app.state.db.app_settings.find_one(
        {"namespace": "provider", "key": provider}
    )
    if not record:
        return {}
    result = {str(k): str(v) for k, v in (record.get("publicValue") or {}).items()}
    for key, encrypted in (record.get("encryptedValue") or {}).items():
        result[key] = request.app.state.vault.decrypt(encrypted)
    return result


@router.get("")
def list_providers(
    request: Request,
    _user: dict = Depends(current_user),
    _admin: dict = Depends(current_admin),
) -> list[dict]:
    result = []
    for provider, definition in PROVIDER_FIELDS.items():
        record = request.app.state.db.app_settings.find_one(
            {"namespace": "provider", "key": provider}
        )
        health = request.app.state.db.provider_health.find_one({"provider": provider})
        result.append(
            {
                "provider": provider,
                "values": record.get("publicValue", {}) if record else {},
                "secrets": record.get("secretFingerprint", {}) if record else {},
                "status": health.get("status", "UNCONFIGURED")
                if health
                else "UNCONFIGURED",
                "checkedAt": iso(health.get("checkedAt")) if health else None,
                "error": health.get("errorRedacted") if health else None,
            }
        )
    return result


@router.put("/{provider}")
def update_provider(
    provider: str,
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "providers:write")
    session_token = request.cookies.get("tf_access", "")
    try:
        issued_at = int(
            jwt.decode(
                session_token,
                request.app.state.settings.auth_secret,
                algorithms=["HS256"],
            )["iat"]
        )
    except Exception as error:
        raise HTTPException(status_code=401, detail="Recent admin login required") from error
    if int(time.time()) - issued_at > 600:
        raise HTTPException(status_code=401, detail="Recent admin login required")
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    values = body.get("values") or {}
    if not isinstance(values, dict):
        raise HTTPException(status_code=422, detail="Provider values must be an object")
    definition = PROVIDER_FIELDS[provider]
    existing = request.app.state.db.app_settings.find_one(
        {"namespace": "provider", "key": provider}
    ) or {}
    public = dict(existing.get("publicValue") or {})
    encrypted = dict(existing.get("encryptedValue") or {})
    fingerprints = dict(existing.get("secretFingerprint") or {})
    for key, raw_value in values.items():
        value = str(raw_value).strip()
        if not value:
            continue
        if key in definition["secret"]:
            encrypted[key] = request.app.state.vault.encrypt(value)
            fingerprints[key] = request.app.state.vault.fingerprint(value)
        else:
            public[key] = value
    now = utc_now()
    request.app.state.db.app_settings.update_one(
        {"namespace": "provider", "key": provider},
        {
            "$set": {
                "publicValue": public,
                "encryptedValue": encrypted,
                "secretFingerprint": fingerprints,
                "updatedById": user["id"],
                "updatedAt": now,
            },
            "$setOnInsert": {
                "namespace": "provider",
                "key": provider,
                "version": 1,
                "createdAt": now,
            },
        },
        upsert=True,
    )
    request.app.state.db.provider_health.update_one(
        {"provider": provider},
        {
            "$set": {"status": "UNCONFIGURED", "updatedAt": now},
            "$setOnInsert": {"provider": provider},
        },
        upsert=True,
    )
    audit(
        request.app.state.db,
        "PROVIDER_SETTINGS_UPDATED",
        "PROVIDER",
        actor_user_id=user["id"],
        actor_admin_id=admin["id"],
        target_id=provider,
        after={"configuredKeys": sorted(set(public) | set(encrypted))},
    )
    return {"provider": provider, "configuredKeys": sorted(set(public) | set(encrypted))}


@router.post("/{provider}/test")
def test_provider(
    provider: str,
    request: Request,
    _user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "providers:write")
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(status_code=404, detail="Unknown provider")
    values = provider_values(request, provider)
    missing = sorted(PROVIDER_FIELDS[provider]["required"] - set(values))
    if missing:
        status_value = "UNCONFIGURED"
        message = f"Missing required settings: {', '.join(missing)}"
        latency = None
    else:
        started = time.monotonic()
        try:
            if provider == "livekit":
                endpoint = values["url"].replace("wss://", "https://").replace(
                    "ws://", "http://"
                )
                httpx.get(endpoint, timeout=5.0)
            elif provider == "gpu" and values.get("endpoint"):
                httpx.get(values["endpoint"], timeout=5.0)
            status_value = "OPERATIONAL"
            message = f"{provider} configuration is available"
            latency = int((time.monotonic() - started) * 1000)
        except Exception as error:
            status_value = "DOWN"
            message = f"{provider} connection failed: {type(error).__name__}"
            latency = int((time.monotonic() - started) * 1000)
    now = utc_now()
    request.app.state.db.provider_health.update_one(
        {"provider": provider},
        {
            "$set": {
                "provider": provider,
                "status": status_value,
                "latencyMs": latency,
                "errorRedacted": None if status_value == "OPERATIONAL" else message,
                "checkedAt": now,
                "updatedAt": now,
            }
        },
        upsert=True,
    )
    return {"provider": provider, "status": status_value, "message": message}
