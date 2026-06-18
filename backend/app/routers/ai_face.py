from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from gridfs import GridFS

from ..ai_providers import (
    GpuInferenceClient,
    decode_image_data_url,
    image_data_url,
)
from ..errors import api_error
from ..provider_policy import CONFIGURED, provider_configuration_status
from ..routers.providers import provider_values
from ..security import current_user
from ..serializers import as_utc, utc_now

router = APIRouter(prefix="/api/ai/face", tags=["ai-face"])
LOGGER = logging.getLogger("trueface.ai-face")
QUALITY_MODES = {"low", "standard", "hd"}


@router.get("/provider-health")
def provider_health(
    request: Request, _user: dict = Depends(current_user)
) -> dict:
    ai_values = provider_values(request, "ai")
    gpu_values = provider_values(request, "gpu")
    ai_health = request.app.state.db.provider_health.find_one({"provider": "ai"})
    gpu_configuration = provider_configuration_status("gpu", gpu_values)
    gpu_result = (
        _gpu_health(request, gpu_values)
        if gpu_configuration == CONFIGURED
        else None
    )
    cloud_available = bool(
        gpu_result and gpu_result.get("providerStatus") == "OPERATIONAL"
    )
    configured_mode = ai_values.get("mode", "browser")
    effective_mode = (
        "cloud"
        if configured_mode == "cloud" and cloud_available
        else "local"
    )
    ai_details = (ai_health or {}).get("details") or {}
    return {
        "effectiveMode": effective_mode,
        "configuredMode": configured_mode,
        "local": {
            "available": True,
            "label": "Local enhanced face mask",
            "requirements": [
                "MediaPipe",
                "Canvas captureStream",
                "WebGL or CPU fallback",
            ],
        },
        "emergentLlm": {
            "configured": bool(
                ai_values.get("gatewayUrl") and ai_values.get("universalKey")
            ),
            "status": (ai_health or {}).get("status", "UNCONFIGURED"),
            "remainingCredits": ai_details.get("remainingCredits"),
            "role": "Provider orchestration and diagnostics only",
        },
        "cloud": {
            "available": cloud_available,
            "label": (
                "Cloud AI face swap"
                if cloud_available
                else "Unavailable / provider not configured"
            ),
            "provider": gpu_values.get("provider"),
            "status": (
                gpu_result.get("providerStatus")
                if gpu_result
                else "UNCONFIGURED"
            ),
            "latencyMs": gpu_result.get("latencyMs") if gpu_result else None,
            "capabilities": gpu_result.get("capabilities", {}) if gpu_result else {},
            "reason": (
                None
                if cloud_available
                else (
                    "GPU provider not configured"
                    if gpu_configuration != CONFIGURED
                    else "GPU provider health check failed"
                )
            ),
        },
    }


@router.post("/process-frame")
def process_frame(
    body: dict,
    request: Request,
    user: dict = Depends(current_user),
) -> dict:
    room_id = str(body.get("roomId") or "").strip()
    profile_id = str(body.get("faceProfileId") or "").strip()
    quality_mode = str(body.get("qualityMode") or "").strip().lower()
    if quality_mode not in QUALITY_MODES:
        raise api_error(
            422,
            "INVALID_QUALITY_MODE",
            "Quality mode must be low, standard, or hd",
        )
    _authorized_room(request, room_id, user["id"])
    profile = request.app.state.db.face_profiles.find_one(
        {
            "id": profile_id,
            "userId": user["id"],
            "active": True,
            "moderationStatus": "APPROVED",
            "consentRevokedAt": None,
            "deletedAt": None,
        }
    )
    if not profile:
        raise api_error(
            403,
            "FACE_PROFILE_NOT_APPROVED",
            "Face profile is not approved and active",
        )
    try:
        frame_mime_type, frame_payload = decode_image_data_url(
            str(body.get("frame") or "")
        )
    except ValueError as error:
        raise api_error(
            422,
            "INVALID_VIDEO_FRAME",
            "Video frame must be a valid JPEG, PNG, or WebP image under 4 MB",
        ) from error

    gpu_values = provider_values(request, "gpu")
    if provider_configuration_status("gpu", gpu_values) != CONFIGURED:
        raise api_error(
            503,
            "GPU_PROVIDER_NOT_CONFIGURED",
            "Cloud AI is unavailable because the GPU provider is not configured",
        )
    face_profile_images = _profile_image_data_urls(request, profile)
    face_profile_image = face_profile_images[0]["image"]
    frame_metadata = _frame_metadata(
        body.get("frameMetadata"), frame_mime_type, len(frame_payload)
    )
    client = GpuInferenceClient(gpu_values)
    try:
        result = client.process_frame(
            frame=str(body["frame"]),
            face_profile_id=profile_id,
            face_profile_image=face_profile_image,
            face_profile_images=face_profile_images,
            frame_metadata=frame_metadata,
            quality_hints=_quality_hints(quality_mode),
            quality_mode=quality_mode,
            room_id=room_id,
            request_id=getattr(request.state, "request_id", ""),
        )
    except Exception as error:
        LOGGER.warning(
            "GPU inference failed request_id=%s provider=%s error_type=%s",
            getattr(request.state, "request_id", None),
            gpu_values.get("provider", "unknown"),
            type(error).__name__,
        )
        _record_gpu_health(
            request,
            status="DOWN",
            latency_ms=None,
            details={},
            message=f"GPU inference failed: {type(error).__name__}",
        )
        raise api_error(
            502,
            "GPU_INFERENCE_FAILED",
            "Cloud face processing failed. Local enhanced face mask remains available.",
        ) from error
    _record_gpu_health(
        request,
        status="OPERATIONAL",
        latency_ms=result.latency_ms,
        details={"capabilities": result.capabilities},
        message=None,
    )
    return {
        "processedFrame": result.processed_frame,
        "latencyMs": result.latency_ms,
        "providerStatus": result.provider_status,
    }


def _authorized_room(request: Request, room_id: str, user_id: str) -> dict:
    room = request.app.state.db.call_rooms.find_one({"id": room_id})
    if not room:
        raise api_error(404, "ROOM_NOT_FOUND", "Call room not found")
    if room.get("status") not in {"OPEN", "ACTIVE"} or as_utc(
        room["expiresAt"]
    ) <= utc_now():
        raise api_error(410, "CALL_EXPIRED", "This call has ended or expired")
    participant = request.app.state.db.call_participants.find_one(
        {
            "roomId": room_id,
            "userId": user_id,
            "state": {"$in": ["APPROVED", "JOINED"]},
        }
    )
    if not participant:
        raise api_error(
            403,
            "ROOM_PARTICIPATION_REQUIRED",
            "You must be an approved room participant to process video frames",
        )
    return room


def _profile_image_data_urls(request: Request, profile: dict) -> list[dict]:
    db = request.app.state.db
    images = list(
        db.face_profile_images.find({"faceProfileId": profile["id"]}, {"_id": 0})
    )
    if not images:
        images = [
            {
                "id": f"{profile['id']}:front",
                "faceProfileId": profile["id"],
                "objectKey": profile["objectKey"],
                "role": "FRONT",
                "mimeType": profile.get("mimeType", "image/jpeg"),
                "qualityScore": profile.get("qualityScore"),
                "width": profile.get("width"),
                "height": profile.get("height"),
            }
        ]
    role_order = {"FRONT": 0, "LEFT": 1, "RIGHT": 2, "LIGHTING": 3, "EXPRESSION": 4}
    images.sort(key=lambda image: role_order.get(str(image.get("role")), 99))
    return [_profile_image_payload(request, image) for image in images[:5]]


def _profile_image_payload(request: Request, image: dict) -> dict:
    item = GridFS(request.app.state.db, collection="uploads").find_one(
        {"filename": image["objectKey"]}
    )
    if not item:
        raise api_error(
            409,
            "FACE_PROFILE_IMAGE_MISSING",
            "The approved face profile image is missing from private storage",
        )
    payload = item.read()
    if len(payload) > 10_000_000:
        raise api_error(
            413,
            "FACE_PROFILE_IMAGE_TOO_LARGE",
            "The approved face profile image exceeds the cloud processing limit",
        )
    stored_type = (getattr(item, "_file", {}) or {}).get("contentType")
    mime_type = stored_type or image.get("mimeType", "image/jpeg")
    return {
        "id": str(image.get("id") or image["objectKey"]),
        "role": str(image.get("role") or "FRONT"),
        "image": image_data_url(payload, mime_type),
        "mimeType": mime_type,
        "qualityScore": image.get("qualityScore"),
        "width": image.get("width"),
        "height": image.get("height"),
    }


def _frame_metadata(value: object, mime_type: str, byte_length: int) -> dict:
    result = {"mimeType": mime_type, "byteLength": byte_length}
    if not isinstance(value, dict):
        return result
    for key in ("width", "height"):
        try:
            parsed = int(value.get(key, 0))
        except (TypeError, ValueError):
            continue
        if 0 < parsed <= 4096:
            result[key] = parsed
    return result


def _quality_hints(quality_mode: str) -> dict:
    return {
        "preserveDetail": True,
        "temporalStability": True,
        "targetMaxLongEdge": {"low": 640, "standard": 960, "hd": 1280}[
            quality_mode
        ],
    }


def _gpu_health(request: Request, values: dict[str, str]) -> dict | None:
    try:
        result = GpuInferenceClient(values).health()
        _record_gpu_health(
            request,
            status="OPERATIONAL",
            latency_ms=result["latencyMs"],
            details={"capabilities": result.get("capabilities", {})},
            message=None,
        )
        return result
    except Exception as error:
        LOGGER.info(
            "GPU health check failed provider=%s error_type=%s",
            values.get("provider", "unknown"),
            type(error).__name__,
        )
        _record_gpu_health(
            request,
            status="DOWN",
            latency_ms=None,
            details={},
            message=f"GPU health check failed: {type(error).__name__}",
        )
        return None


def _record_gpu_health(
    request: Request,
    *,
    status: str,
    latency_ms: int | None,
    details: dict,
    message: str | None,
) -> None:
    now = utc_now()
    request.app.state.db.provider_health.update_one(
        {"provider": "gpu"},
        {
            "$set": {
                "provider": "gpu",
                "status": status,
                "latencyMs": latency_ms,
                "details": details,
                "errorRedacted": message,
                "checkedAt": now,
                "updatedAt": now,
            }
        },
        upsert=True,
    )
