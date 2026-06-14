from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..provider_policy import (
    CONFIGURED,
    apply_provider_defaults,
    provider_configuration_status,
)
from ..routers.providers import provider_values
from ..security import current_user

router = APIRouter(prefix="/api/system", tags=["system"])


def readiness_payload(request: Request) -> dict:
    database_ready = _database_ready(request)
    ai_values = apply_provider_defaults(
        "ai", provider_values(request, "ai")
    )
    ai_health = request.app.state.db.provider_health.find_one(
        {"provider": "ai"}
    )
    gpu_values = provider_values(request, "gpu")
    gpu_health = request.app.state.db.provider_health.find_one(
        {"provider": "gpu"}
    )
    ai_enabled = ai_values.get("enabled", "true").lower() == "true"
    # Local processing is the mandatory fallback for every enabled policy,
    # including cloud-only preference when the optional worker is unavailable.
    browser_enabled = ai_enabled
    emergent_configured = bool(
        ai_values.get("gatewayUrl") and ai_values.get("universalKey")
    )
    emergent_ready = bool(
        emergent_configured
        and ai_health
        and ai_health.get("status") == "OPERATIONAL"
    )
    ai_details = (ai_health or {}).get("details") or {}
    gpu_configured = provider_configuration_status(
        "gpu", gpu_values
    ) == CONFIGURED
    cloud_ready = bool(
        gpu_configured
        and gpu_health
        and gpu_health.get("status") == "OPERATIONAL"
    )
    checks = {
        "database": _check(
            database_ready,
            (
                "Emergent MongoDB is connected."
                if database_ready
                else "MongoDB is unavailable."
            ),
            required=True,
        ),
        "livekit": _provider_check(
            request,
            "livekit",
            "LiveKit URL, API key, and API secret are required for video calls.",
            required=True,
        ),
        "storage": _provider_check(
            request,
            "storage",
            "Private uploads use MongoDB GridFS.",
            required=True,
        ),
        "ai": _check(
            ai_enabled,
            (
                "Face processing is enabled. Local mode remains available when cloud services are unavailable."
                if ai_enabled
                else "AI processing is disabled."
            ),
            required=True,
        ),
        "browserAi": _check(
            browser_enabled,
            (
                "Browser/device processing is enabled; this device is checked in the browser."
                if browser_enabled
                else "Browser processing is disabled by the selected AI mode."
            ),
            required=True,
        ),
        "emergentAi": {
            **_check(
                emergent_ready,
                (
                    "Emergent LLM access was verified for orchestration and diagnostics."
                    if emergent_ready
                    else "Emergent LLM credits are unavailable or have not been tested."
                ),
                required=False,
            ),
            "remainingCredits": ai_details.get("remainingCredits"),
        },
        "cloudAi": _check(
            cloud_ready,
            (
                "The configured GPU worker passed its health check."
                if cloud_ready
                else "Cloud face-video processing is unavailable; local enhanced face mask remains the fallback."
            ),
            required=False,
        ),
        "email": _provider_check(
            request,
            "email",
            "Configure Gmail SMTP, custom SMTP, or Resend for production email.",
            required=False,
        ),
    }
    blockers = [
        check["message"]
        for check in checks.values()
        if check["requiredForCalls"] and check["status"] != "READY"
    ]
    return {
        "callCreationReady": not blockers,
        "checks": checks,
        "blockingReasons": blockers,
    }


@router.get("/readiness")
def readiness(
    request: Request, _user: dict = Depends(current_user)
) -> dict:
    return readiness_payload(request)


def _provider_check(
    request: Request,
    provider: str,
    missing_message: str,
    required: bool,
) -> dict:
    values = apply_provider_defaults(provider, provider_values(request, provider))
    status = provider_configuration_status(provider, values)
    if status == CONFIGURED:
        if provider == "livekit":
            message = "LiveKit credentials are configured for token generation."
        elif provider == "email":
            message = "Email delivery settings are configured."
        elif provider == "ai":
            message = (
                "Browser AI is ready on supported devices."
                if values.get("provider") == "browser"
                else "Cloud AI settings are configured."
            )
        else:
            message = missing_message
        return _check(True, message, required=required)
    return _check(False, missing_message, required=required)


def _check(ready: bool, message: str, required: bool) -> dict:
    return {
        "status": "READY" if ready else "MISSING",
        "message": message,
        "requiredForCalls": required,
    }


def _database_ready(request: Request) -> bool:
    try:
        request.app.state.db.list_collection_names()
        return True
    except Exception:
        return False
