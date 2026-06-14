from __future__ import annotations

import os
import time
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from ..ai_providers import EmergentLlmClient
from ..audit import audit
from ..email_service import send_email
from ..provider_policy import (
    CONFIGURED,
    apply_provider_defaults,
    provider_configuration_status,
)
from ..security import current_admin, current_user, require_permission
from ..serializers import iso, utc_now

router = APIRouter(prefix="/api/admin/providers", tags=["providers"])

PROVIDER_FIELDS = {
    "livekit": {
        "secret": {"apiKey", "apiSecret"},
        "public": {"enabled", "url"},
    },
    "storage": {
        "secret": {"accessKey", "secretAccessKey"},
        "public": {
            "provider",
            "futureProvider",
            "endpoint",
            "region",
            "bucket",
            "forcePathStyle",
            "managedBy",
        },
    },
    "paystack": {
        "secret": {"secretKey", "webhookSecret"},
        "public": {"enabled", "mode"},
    },
    "flutterwave": {
        "secret": {"secretKey", "encryptionKey", "webhookHash"},
        "public": {"enabled", "mode"},
    },
    "email": {
        "secret": {"apiKey", "password", "appPassword"},
        "public": {
            "provider",
            "senderEmail",
            "senderName",
            "host",
            "port",
            "username",
            "secure",
        },
    },
    "ai": {
        "secret": {"universalKey"},
        "public": {
            "enabled",
            "mode",
            "provider",
            "gatewayUrl",
            "creditsPath",
            "healthPath",
            "chatPath",
            "model",
            "estimatedNairaPerMinute",
            "browserModelUrl",
        },
    },
    "gpu": {
        "secret": {"apiKey", "secretKey"},
        "public": {
            "provider",
            "enabled",
            "endpoint",
            "healthEndpoint",
            "region",
            "model",
            "timeoutSeconds",
            "fallbackMode",
            "maxFramesPerSecond",
            "photorealistic",
        },
    },
    "manual-bank": {
        "secret": set(),
        "public": {
            "enabled",
            "bankName",
            "accountName",
            "accountNumber",
            "currency",
            "minimumAmount",
            "maximumAmount",
            "minimumMinor",
            "maximumMinor",
            "proofRequired",
            "manualReviewRequired",
            "instructions",
            "expiryMinutes",
        },
    },
    "monitoring": {
        "secret": {"dsn"},
        "public": {"enabled", "logLevel", "webhookLogging"},
    },
    "whatsapp": {
        "secret": {"token", "verifyToken"},
        "public": {
            "enabled",
            "phoneNumberId",
            "businessAccountId",
        },
    },
}

PROVIDER_ENV = {
    "livekit": {
        "url": "LIVEKIT_URL",
        "apiKey": "LIVEKIT_API_KEY",
        "apiSecret": "LIVEKIT_API_SECRET",
    },
    "paystack": {"secretKey": "PAYSTACK_SECRET_KEY"},
    "flutterwave": {
        "secretKey": "FLUTTERWAVE_SECRET_KEY",
        "webhookHash": "FLUTTERWAVE_WEBHOOK_HASH",
    },
    "email": {
        "provider": "EMAIL_PROVIDER",
        "senderEmail": "EMAIL_SENDER",
        "senderName": "EMAIL_SENDER_NAME",
        "host": "SMTP_HOST",
        "port": "SMTP_PORT",
        "username": "SMTP_USERNAME",
        "password": "SMTP_PASSWORD",
        "apiKey": "RESEND_API_KEY",
    },
    "ai": {
        "gatewayUrl": "EMERGENT_LLM_BASE_URL",
        "universalKey": "EMERGENT_LLM_API_KEY",
        "chatPath": "EMERGENT_LLM_CHAT_PATH",
        "model": "EMERGENT_LLM_MODEL",
    },
    "gpu": {
        "provider": "GPU_PROVIDER",
        "endpoint": "GPU_INFERENCE_URL",
        "apiKey": "GPU_INFERENCE_API_KEY",
        "healthEndpoint": "GPU_HEALTH_URL",
    },
}


def _environment_values(provider: str) -> dict[str, str]:
    result = {
        key: value
        for key, env_name in PROVIDER_ENV.get(provider, {}).items()
        if (value := os.getenv(env_name, "").strip())
    }
    if provider == "ai":
        result.setdefault(
            "gatewayUrl", os.getenv("EMERGENT_AI_GATEWAY_URL", "").strip()
        )
        result.setdefault(
            "universalKey",
            os.getenv("EMERGENT_AI_UNIVERSAL_KEY", "").strip(),
        )
        face_provider = os.getenv("AI_FACE_PROVIDER", "").strip().lower()
        if face_provider in {"local", "browser"}:
            result["mode"] = "browser"
        elif face_provider == "cloud":
            result["mode"] = "cloud"
        result = {key: value for key, value in result.items() if value}
    return result


def provider_values(request: Request, provider: str) -> dict[str, str]:
    record = request.app.state.db.app_settings.find_one(
        {"namespace": "provider", "key": provider}
    )
    result = _environment_values(provider)
    if not record:
        return result
    result.update(
        {str(k): str(v) for k, v in (record.get("publicValue") or {}).items()}
    )
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
        fallback = _environment_values(provider)
        public_keys = definition["public"]
        secret_keys = definition["secret"]
        public_values = {
            key: value for key, value in fallback.items() if key in public_keys
        }
        public_values.update(record.get("publicValue", {}) if record else {})
        secret_fingerprints = {
            key: request.app.state.vault.fingerprint(value)
            for key, value in fallback.items()
            if key in secret_keys
        }
        secret_fingerprints.update(
            record.get("secretFingerprint", {}) if record else {}
        )
        configured_values = {
            **{str(key): str(value) for key, value in public_values.items()},
            **{str(key): str(value) for key, value in secret_fingerprints.items()},
        }
        effective_public = apply_provider_defaults(
            provider,
            {str(key): str(value) for key, value in public_values.items()},
        )
        result.append(
            {
                "provider": provider,
                "values": effective_public,
                "secrets": secret_fingerprints,
                "configurationStatus": provider_configuration_status(
                    provider, configured_values
                ),
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
    unknown = set(values) - definition["public"] - definition["secret"]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown provider fields: {', '.join(sorted(unknown))}",
        )
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
    public = apply_provider_defaults(provider, public)
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
    return {
        "provider": provider,
        "configuredKeys": sorted(set(public) | set(encrypted)),
        "configurationStatus": provider_configuration_status(
            provider, {**public, **fingerprints}
        ),
    }


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
    configuration_status = provider_configuration_status(provider, values)
    if configuration_status != CONFIGURED:
        status_value = "UNCONFIGURED"
        message = (
            "Add the remaining required settings before testing this provider."
        )
        latency = None
    else:
        started = time.monotonic()
        message = f"{provider.title()} settings are complete."
        try:
            if provider == "livekit":
                endpoint = values["url"].replace("wss://", "https://").replace(
                    "ws://", "http://"
                )
                response = httpx.get(endpoint, timeout=5.0)
                message = (
                    "LiveKit endpoint responded and token-signing credentials are present. "
                    f"Endpoint status: {response.status_code}."
                )
            elif provider == "ai":
                if not values.get("gatewayUrl") or not values.get("universalKey"):
                    health_details = {
                        "remainingCredits": None,
                        "llmAccess": False,
                        "capabilities": {},
                    }
                    message = (
                        "Local face processing is configured and needs no cloud key. "
                        "Emergent LLM diagnostics remain optional and unconfigured."
                    )
                else:
                    endpoint = _provider_url(
                        values["gatewayUrl"],
                        values.get("healthPath", "/health"),
                    )
                    response = httpx.get(
                        endpoint,
                        headers={
                            "Authorization": f"Bearer {values['universalKey']}",
                            "Accept": "application/json",
                        },
                        timeout=8.0,
                    )
                    response.raise_for_status()
                    payload = response.json()
                    remaining_credits = _remaining_ai_credits(payload)
                    capabilities = payload.get("capabilities") or {}
                    health_details = {
                        "remainingCredits": remaining_credits,
                        "llmAccess": True,
                        "capabilities": (
                            capabilities if isinstance(capabilities, dict) else {}
                        ),
                    }
                    message = (
                        "Emergent LLM access is working for orchestration and diagnostics. "
                        + (
                            f"{remaining_credits} AI credits reported."
                            if remaining_credits is not None
                            else "The gateway did not report a credit balance."
                        )
                    )
            elif provider == "gpu" and values.get("endpoint"):
                response = httpx.get(
                    values.get("healthEndpoint") or values["endpoint"],
                    headers={
                        "Authorization": f"Bearer {values['apiKey']}",
                        "Accept": "application/json",
                    },
                    timeout=5.0,
                )
                response.raise_for_status()
                payload = response.json()
                capabilities = (
                    payload.get("capabilities")
                    if isinstance(payload, dict)
                    else {}
                )
                health_details = {
                    "capabilities": (
                        capabilities if isinstance(capabilities, dict) else {}
                    )
                }
                message = (
                    "GPU worker is reachable through the normalized TrueFace "
                    "frame-inference contract."
                )
            elif provider == "storage":
                request.app.state.db.list_collection_names()
                message = (
                    "MongoDB GridFS private storage is operational. "
                    "External R2/S3 fields are migration settings only."
                )
            elif provider == "manual-bank":
                message = "Bank-transfer checkout is configured for manual review."
            elif provider == "email":
                message = "Email settings are complete. Use Send test email to verify delivery."
            else:
                message = f"{provider.title()} settings are complete."
            status_value = "OPERATIONAL"
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
                "details": locals().get("health_details", {})
                if status_value == "OPERATIONAL"
                else {},
                "checkedAt": now,
                "updatedAt": now,
            }
        },
        upsert=True,
    )
    details = locals().get("health_details", {})
    return {
        "provider": provider,
        "status": status_value,
        "message": message,
        **details,
    }


@router.post("/ai/diagnostics")
def ai_diagnostics(
    request: Request,
    _user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "providers:write")
    ai_values = provider_values(request, "ai")
    client = EmergentLlmClient(ai_values)
    if not client.configured:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "EMERGENT_LLM_NOT_CONFIGURED",
                "message": "Configure the Emergent LLM base URL and API key before running AI diagnostics.",
            },
        )
    ai_health = request.app.state.db.provider_health.find_one(
        {"provider": "ai"}
    ) or {}
    gpu_values = provider_values(request, "gpu")
    gpu_health = request.app.state.db.provider_health.find_one(
        {"provider": "gpu"}
    ) or {}
    payload = {
        "configuredMode": ai_values.get("mode", "browser"),
        "localAvailable": True,
        "emergentLlmStatus": ai_health.get("status", "UNTESTED"),
        "remainingLlmCredits": (ai_health.get("details") or {}).get(
            "remainingCredits"
        ),
        "gpuConfigured": (
            provider_configuration_status("gpu", gpu_values) == CONFIGURED
        ),
        "gpuProvider": gpu_values.get("provider"),
        "gpuStatus": gpu_health.get("status", "UNTESTED"),
        "gpuLastError": gpu_health.get("errorRedacted"),
    }
    try:
        result = client.complete_json(
            system_prompt=(
                "You are the TrueFace provider diagnostics assistant. Use only "
                "the supplied provider status metadata. Recommend local or cloud "
                "mode, explain failures safely, and list concrete admin actions. "
                "An LLM is not a realtime face-swap engine. Return JSON with "
                "recommendedMode, summary, and actions."
            ),
            payload=payload,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "EMERGENT_LLM_DIAGNOSTICS_FAILED",
                "message": (
                    "Emergent LLM diagnostics could not be completed. "
                    f"Provider error type: {type(error).__name__}."
                ),
            },
        ) from error
    if not result:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "EMERGENT_LLM_DIAGNOSTICS_FAILED",
                "message": "Emergent LLM returned no diagnostics.",
            },
        )
    audit(
        request.app.state.db,
        "AI_PROVIDER_DIAGNOSTICS_RUN",
        "PROVIDER",
        actor_user_id=_user["id"],
        actor_admin_id=admin["id"],
        target_id="ai",
        after={
            "recommendedMode": result.get("recommendedMode"),
            "gpuStatus": payload["gpuStatus"],
            "emergentLlmStatus": payload["emergentLlmStatus"],
        },
    )
    return result


@router.post("/email/test-email")
def send_test_email(
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
    admin: dict = Depends(current_admin),
) -> dict:
    require_permission(admin, "providers:write")
    recipient = str(body.get("recipient") or user["email"]).strip().lower()
    if "@" not in recipient:
        raise HTTPException(status_code=422, detail="Enter a valid test email address")
    values = provider_values(request, "email")
    if provider_configuration_status("email", values) != CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Finish the email provider configuration before sending a test.",
        )
    try:
        send_email(
            values,
            recipient,
            "TrueFace Calls email test",
            "Your TrueFace Calls production email configuration is working.",
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Test email could not be delivered: {type(error).__name__}",
        ) from error
    audit(
        request.app.state.db,
        "PROVIDER_TEST_EMAIL_SENT",
        "PROVIDER",
        actor_user_id=user["id"],
        actor_admin_id=admin["id"],
        target_id="email",
        after={"recipient": recipient},
    )
    return {"message": f"Test email sent to {recipient}."}


def _provider_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _remaining_ai_credits(payload: dict[str, Any]) -> int | float | None:
    direct = payload.get("remainingCredits")
    if isinstance(direct, (int, float)):
        return direct
    credits = payload.get("credits")
    if isinstance(credits, dict):
        remaining = credits.get("remaining")
        if isinstance(remaining, (int, float)):
            return remaining
    return None
