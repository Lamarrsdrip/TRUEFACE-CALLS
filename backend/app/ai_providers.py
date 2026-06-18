from __future__ import annotations

import base64
import binascii
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx


ALLOWED_FRAME_TYPES = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/webp": b"RIFF",
}
MAX_FRAME_BYTES = 4_000_000


class ProviderResponseError(RuntimeError):
    pass


def decode_image_data_url(
    value: str, *, max_bytes: int = MAX_FRAME_BYTES
) -> tuple[str, bytes]:
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise ValueError("Frame must be an image data URL")
    if len(value) > int(max_bytes * 1.4) + 256:
        raise ValueError("Image frame size is invalid")
    try:
        header, encoded = value.split(",", 1)
        mime_type = header[5:].split(";", 1)[0].lower()
        if ";base64" not in header.lower() or mime_type not in ALLOWED_FRAME_TYPES:
            raise ValueError("Unsupported image frame")
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid image frame") from error
    if not payload or len(payload) > max_bytes:
        raise ValueError("Image frame size is invalid")
    signature = ALLOWED_FRAME_TYPES[mime_type]
    if not payload.startswith(signature):
        raise ValueError("Image signature does not match its type")
    if mime_type == "image/webp" and (
        len(payload) < 12 or payload[8:12] != b"WEBP"
    ):
        raise ValueError("Image signature does not match its type")
    return mime_type, payload


def image_data_url(payload: bytes, mime_type: str) -> str:
    return f"data:{mime_type};base64,{base64.b64encode(payload).decode()}"


@dataclass(frozen=True)
class GpuInferenceResult:
    processed_frame: str
    latency_ms: int
    provider_status: str
    capabilities: dict[str, Any]


class GpuInferenceClient:
    def __init__(self, values: dict[str, str]):
        self.values = values

    @property
    def configured(self) -> bool:
        return all(
            self.values.get(key) for key in ("provider", "endpoint", "apiKey")
        )

    def health(self) -> dict[str, Any]:
        if not self.configured:
            raise ProviderResponseError("GPU provider not configured")
        started = time.monotonic()
        response = httpx.get(
            self.values.get("healthEndpoint") or self.values["endpoint"],
            headers=self._headers(),
            timeout=min(self._timeout(), 8.0),
        )
        response.raise_for_status()
        payload = _json_object(response)
        capabilities = payload.get("capabilities")
        return {
            "latencyMs": int((time.monotonic() - started) * 1000),
            "capabilities": (
                capabilities if isinstance(capabilities, dict) else {}
            ),
            "providerStatus": _normalized_status(
                payload.get("providerStatus") or payload.get("status")
            ),
        }

    def process_frame(
        self,
        *,
        frame: str,
        face_profile_id: str,
        face_profile_image: str,
        face_profile_images: list[dict[str, Any]],
        frame_metadata: dict[str, Any],
        quality_hints: dict[str, Any],
        quality_mode: str,
        room_id: str,
        request_id: str,
    ) -> GpuInferenceResult:
        if not self.configured:
            raise ProviderResponseError("GPU provider not configured")
        started = time.monotonic()
        response = httpx.post(
            self.values["endpoint"],
            headers=self._headers(),
            json={
                "frame": frame,
                "faceProfileId": face_profile_id,
                "faceProfileImage": face_profile_image,
                "faceProfileImages": face_profile_images,
                "frameMetadata": frame_metadata,
                "qualityHints": quality_hints,
                "qualityMode": quality_mode,
                "roomId": room_id,
                "requestId": request_id,
            },
            timeout=self._timeout(),
        )
        response.raise_for_status()
        payload = _json_object(response)
        processed_frame = payload.get("processedFrame")
        if not isinstance(processed_frame, str):
            raise ProviderResponseError("GPU worker omitted processedFrame")
        decode_image_data_url(processed_frame)
        provider_latency = payload.get("latencyMs")
        latency_ms = (
            int(provider_latency)
            if isinstance(provider_latency, (int, float))
            else int((time.monotonic() - started) * 1000)
        )
        capabilities = payload.get("capabilities")
        return GpuInferenceResult(
            processed_frame=processed_frame,
            latency_ms=max(0, latency_ms),
            provider_status=_normalized_status(payload.get("providerStatus")),
            capabilities=capabilities if isinstance(capabilities, dict) else {},
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.values['apiKey']}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-TrueFace-Provider": self.values.get("provider", "custom"),
        }

    def _timeout(self) -> float:
        try:
            return max(2.0, min(float(self.values.get("timeoutSeconds", "12")), 30.0))
        except (TypeError, ValueError):
            return 12.0


class EmergentLlmClient:
    """Optional reasoning adapter. It never performs frame inference."""

    def __init__(self, values: dict[str, str]):
        self.values = values

    @property
    def configured(self) -> bool:
        return bool(
            self.values.get("gatewayUrl") and self.values.get("universalKey")
        )

    def complete_json(
        self, *, system_prompt: str, payload: dict[str, Any]
    ) -> dict[str, Any] | None:
        if not self.configured:
            return None
        endpoint = _provider_url(
            self.values["gatewayUrl"],
            self.values.get("chatPath", "/chat/completions"),
        )
        response = httpx.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {self.values['universalKey']}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={
                "model": self.values.get("model", "emergent-universal"),
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(payload, separators=(",", ":"))},
                ],
            },
            timeout=5.0,
        )
        response.raise_for_status()
        body = _json_object(response)
        content = (
            ((body.get("choices") or [{}])[0].get("message") or {}).get("content")
        )
        if isinstance(content, dict):
            return content
        if not isinstance(content, str):
            raise ProviderResponseError("Emergent LLM returned no JSON content")
        parsed = json.loads(content)
        if not isinstance(parsed, dict):
            raise ProviderResponseError("Emergent LLM response was not an object")
        return parsed


def _provider_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _json_object(response: Any) -> dict[str, Any]:
    payload = response.json()
    if not isinstance(payload, dict):
        raise ProviderResponseError("Provider returned a non-object response")
    return payload


def _normalized_status(value: Any) -> str:
    status = str(value or "OPERATIONAL").strip().upper()
    if status in {"OK", "HEALTHY", "READY", "UP"}:
        return "OPERATIONAL"
    return status
