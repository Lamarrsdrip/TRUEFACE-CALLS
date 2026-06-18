from __future__ import annotations

import os
import time
from typing import Any, Optional, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .errors import WorkerProcessingError


class WorkerEngine(Protocol):
    def health(self) -> dict[str, Any]:
        ...

    def process(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...


def create_app(
    *,
    engine: WorkerEngine | None = None,
    api_key: str | None = None,
) -> FastAPI:
    app = FastAPI(title="TrueFace RunPod Worker", version="0.1.0")
    worker_engine = engine or _load_default_engine()
    expected_key = api_key if api_key is not None else os.getenv("TRUEFACE_WORKER_API_KEY", "")

    def require_auth(authorization: Optional[str] = Header(default=None)) -> None:
        if not expected_key:
            return
        expected = f"Bearer {expected_key}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Invalid worker API key")

    @app.get("/health")
    def health() -> dict[str, Any]:
        payload = worker_engine.health()
        return {
            "status": "OPERATIONAL" if payload.get("modelsLoaded") else "DEGRADED",
            **payload,
        }

    @app.post("/process-frame")
    def process_frame(
        payload: dict[str, Any],
        _auth: None = Depends(require_auth),
    ) -> JSONResponse:
        _validate_payload(payload)
        started = time.perf_counter()
        try:
            result = worker_engine.process(payload)
        except WorkerProcessingError as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "error": {
                        "code": exc.code,
                        "message": exc.message,
                    }
                },
            )
        if result.get("processedFrame") == payload.get("frame"):
            raise HTTPException(
                status_code=502,
                detail="Worker returned an unsafe pass-through frame",
            )
        result.setdefault("providerStatus", "OPERATIONAL")
        result.setdefault("latencyMs", int((time.perf_counter() - started) * 1000))
        return JSONResponse(result)

    return app


def _validate_payload(payload: dict[str, Any]) -> None:
    if not isinstance(payload.get("frame"), str) or not payload["frame"].startswith(
        "data:image/"
    ):
        raise HTTPException(status_code=422, detail="frame must be an image data URL")
    if not payload.get("faceProfileId"):
        raise HTTPException(status_code=422, detail="faceProfileId is required")
    images = payload.get("faceProfileImages")
    if not isinstance(images, list) or not images:
        raise HTTPException(
            status_code=422,
            detail="faceProfileImages must include at least one approved reference",
        )
    if payload.get("qualityMode") not in {"low", "standard", "hd"}:
        raise HTTPException(status_code=422, detail="qualityMode is invalid")
    if not payload.get("roomId"):
        raise HTTPException(status_code=422, detail="roomId is required")


def _load_default_engine() -> WorkerEngine:
    from .engine import ProductionFaceSwapEngine

    return ProductionFaceSwapEngine.from_environment()
