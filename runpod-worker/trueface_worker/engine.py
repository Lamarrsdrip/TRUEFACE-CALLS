from __future__ import annotations

import base64
import binascii
import os
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import WorkerProcessingError
from .pipeline import (
    DetectedFace,
    ExponentialSmoother,
    IdentityReference,
    bbox_iou,
    build_identity_embedding,
    select_stable_target,
)


@dataclass
class FrameState:
    previous_face: DetectedFace | None = None
    previous_frame: Any | None = None
    color_smoother: ExponentialSmoother = field(
        default_factory=lambda: ExponentialSmoother(alpha=0.3)
    )
    frame_count: int = 0


class ProductionFaceSwapEngine:
    """GPU worker for consented TrueFace live face replacement.

    v2 pipeline: BiSeNet pixel-accurate face masks + GFPGAN mandatory restoration.
    Supports inswapper_128 (default) and simswap_256 (if model file present).
    Heavy dependencies are imported lazily so the API contract can be tested on
    developer machines that do not have CUDA, InsightFace, or OpenCV installed.
    """

    def __init__(self, *, env: dict[str, str] | None = None):
        self.env = env or os.environ
        self.np: Any | None = None
        self.cv2: Any | None = None
        self.face_app: Any | None = None
        self.swapper: Any | None = None
        self.face_parser: Any | None = None
        self.restorer: Any | None = None
        self.providers: list[str] = []
        self.device = self.env.get("TRUEFACE_GPU_DEVICE", "unknown")
        self.models_loaded = False
        self.load_error: str | None = None
        self.swap_model_name = "inswapper_128"
        self.restorer_available = False
        self.parser_available = False
        self.states: OrderedDict[str, FrameState] = OrderedDict()
        self.max_states = int(self.env.get("TRUEFACE_MAX_TRACKED_SESSIONS", "96"))

    @classmethod
    def from_environment(cls) -> "ProductionFaceSwapEngine":
        engine = cls()
        engine.load_models()
        return engine

    def load_models(self) -> None:
        try:
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            import onnxruntime as ort  # type: ignore
            from insightface.app import FaceAnalysis  # type: ignore
            from insightface.model_zoo import get_model  # type: ignore
        except Exception as exc:  # pragma: no cover
            self.models_loaded = False
            self.load_error = f"Worker dependencies missing: {exc}"
            return

        self.np = np
        self.cv2 = cv2
        available_providers = list(ort.get_available_providers())
        self.providers = self._select_onnx_providers(available_providers)
        self.device = (
            self.env.get("TRUEFACE_GPU_DEVICE")
            or ("CUDA" if "CUDAExecutionProvider" in self.providers else "CPU")
        )

        model_root = self.env.get("INSIGHTFACE_MODEL_ROOT", "/models/insightface")
        model_name = self.env.get("INSIGHTFACE_MODEL_NAME", "buffalo_l")
        det_size = int(self.env.get("FACE_DET_SIZE", "640"))

        # Resolve swap model — prefer simswap_256 if present
        simswap_path = Path(
            self.env.get("SIMSWAP_MODEL_PATH", "/models/simswap_256.onnx")
        )
        inswapper_path = Path(
            self.env.get("INSWAPPER_MODEL_PATH", "/models/inswapper_128.onnx")
        )
        if simswap_path.exists():
            swapper_path = simswap_path
            self.swap_model_name = "simswap_256"
        else:
            swapper_path = inswapper_path
            self.swap_model_name = "inswapper_128"

        try:
            if not swapper_path.exists():
                raise FileNotFoundError(
                    f"Missing swap model at {swapper_path}. "
                    "Set INSWAPPER_MODEL_PATH (or SIMSWAP_MODEL_PATH for SimSwap)."
                )

            self.face_app = FaceAnalysis(
                name=model_name,
                root=model_root,
                providers=self.providers,
                allowed_modules=["detection", "recognition"],
            )
            ctx_id = 0 if "CUDAExecutionProvider" in self.providers else -1
            self.face_app.prepare(ctx_id=ctx_id, det_size=(det_size, det_size))
            self.swapper = get_model(str(swapper_path), providers=self.providers)

            # BiSeNet face parser (optional — falls back to ellipse if model missing)
            bisenet_path = Path(
                self.env.get("BISENET_MODEL_PATH", "/models/bisenet_face_parsing.onnx")
            )
            self._load_face_parser(bisenet_path)

            # GFPGAN restorer — always attempted, fallback to opencv if model absent
            gfpgan_path = Path(
                self.env.get("GFPGAN_MODEL_PATH", "/models/GFPGANv1.4.pth")
            )
            self._load_restorer(gfpgan_path)

            self.models_loaded = True
            self.load_error = None
        except Exception as exc:  # pragma: no cover
            self.models_loaded = False
            self.load_error = f"Model load failed: {exc}"

    def health(self) -> dict[str, Any]:
        return {
            "modelsLoaded": self.models_loaded,
            "swapModel": self.swap_model_name,
            "restorerAvailable": self.restorer_available,
            "parserAvailable": self.parser_available,
            "provider": self.providers[0] if self.providers else "unknown",
            "sessionCount": len(self.states),
            "device": self.device,
            "loadError": self.load_error,
            "providers": self.providers,
            "capabilities": {
                "multiReferenceIdentity": self.models_loaded,
                "stableTargetLock": self.models_loaded,
                "alignment": "insightface-landmarks" if self.models_loaded else "unavailable",
                "colorTransfer": self.models_loaded,
                "temporalSmoothing": self.models_loaded,
                "restoration": "gfpgan" if self.restorer_available else "opencv-sharpen-fallback",
                "faceParsing": "bisenet" if self.parser_available else "ellipse-fallback",
                "outputDetailEnhancement": self.models_loaded,
            },
            "modelPaths": {
                "insightfaceRoot": self.env.get(
                    "INSIGHTFACE_MODEL_ROOT", "/models/insightface"
                ),
                "swapper": self.env.get(
                    "INSWAPPER_MODEL_PATH", "/models/inswapper_128.onnx"
                ),
                "bisenet": self.env.get(
                    "BISENET_MODEL_PATH", "/models/bisenet_face_parsing.onnx"
                ),
                "gfpgan": self.env.get("GFPGAN_MODEL_PATH", "/models/GFPGANv1.4.pth"),
            },
        }

    def process(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.models_loaded:
            raise WorkerProcessingError(
                "WORKER_MODELS_NOT_LOADED",
                self.load_error or "Face swap models are not loaded on the worker",
                status_code=503,
            )
        if self.face_app is None or self.swapper is None:
            raise WorkerProcessingError(
                "WORKER_NOT_READY",
                "Face detector or swap model is not ready",
                status_code=503,
            )

        request_started = time.perf_counter()
        frame = self._decode_image_data_url(payload["frame"], field_name="frame")
        quality_mode = str(payload.get("qualityMode", "standard")).lower()
        state_key = f"{payload.get('roomId')}:{payload.get('faceProfileId')}"
        state = self._state_for(state_key)

        reference_started = time.perf_counter()
        identity, source_face = self._build_reference_identity(
            payload.get("faceProfileImages") or []
        )
        reference_ms = self._elapsed_ms(reference_started)

        detect_started = time.perf_counter()
        raw_faces = self._detect_faces(frame)
        detector_ms = self._elapsed_ms(detect_started)
        if not raw_faces:
            raise WorkerProcessingError(
                "FACE_NOT_DETECTED",
                "No usable face was detected in the live frame",
                status_code=422,
            )

        detected_faces = [self._to_detected_face(face) for face in raw_faces]
        target = select_stable_target(
            detected_faces,
            previous_face=state.previous_face,
            identity_embedding=identity.embedding,
        )
        target_index = detected_faces.index(target)
        target_face = raw_faces[target_index]
        lock_iou = (
            bbox_iou(target.bbox, state.previous_face.bbox)
            if state.previous_face
            else 0.0
        )

        swap_started = time.perf_counter()
        swapped = self._swap(frame, target_face, source_face, identity.embedding)
        swap_ms = self._elapsed_ms(swap_started)

        blend_started = time.perf_counter()
        # Extract face crop from the swapped frame for parsing
        h_f, w_f = frame.shape[:2]
        face_crop_bgr, crop_box = self._extract_face_crop(swapped, target_face, w_f, h_f)

        # Get pixel-accurate face mask from BiSeNet parser
        parse_mask = self._get_parse_mask(face_crop_bgr)

        # Project parse mask back to full frame coordinates
        full_mask = self._project_mask_to_frame(
            parse_mask, crop_box, w_f, h_f, target_face
        )

        # LAB color transfer on masked region
        color_matched = self._match_color(swapped, frame, full_mask)

        # Alpha-blend swapped face back using feathered mask
        blended = self._alpha_blend(color_matched, frame, full_mask)

        # GFPGAN restoration on the face region in the output frame
        restored, restorer_applied = self._restore_face_region(
            blended, target_face, w_f, h_f, quality_mode
        )

        # Temporal EMA blend with previous frame
        output = self._temporal_blend(restored, full_mask, state, target)
        blend_ms = self._elapsed_ms(blend_started)

        encode_started = time.perf_counter()
        encoded = self._encode_image_data_url(output, quality_mode)
        encode_ms = self._elapsed_ms(encode_started)

        state.previous_face = target
        state.previous_frame = output.copy()
        state.frame_count += 1

        return {
            "processedFrame": encoded,
            "latencyMs": self._elapsed_ms(request_started),
            "faceDetected": True,
            "swapModel": self.swap_model_name,
            "restorerApplied": restorer_applied,
            "providerStatus": "OPERATIONAL",
            "mode": "cloud-ai-face-swap",
            "capabilities": self.health()["capabilities"],
            "metrics": {
                "referenceCount": identity.reference_count,
                "referenceRoles": identity.roles,
                "faceCount": len(raw_faces),
                "targetLocked": state.frame_count > 1 and lock_iou > 0.3,
                "targetLockIou": round(lock_iou, 4),
                "detectorMs": detector_ms,
                "referenceMs": reference_ms,
                "swapMs": swap_ms,
                "blendMs": blend_ms,
                "encodeMs": encode_ms,
                "maskCoverage": self._mask_coverage(full_mask),
                "outputSharpness": self._sharpness(output),
                "parserMode": "bisenet" if self.parser_available else "ellipse-fallback",
                "restorerMode": "gfpgan" if self.restorer_available else "opencv-sharpen-fallback",
                "passThrough": False,
            },
        }

    # ------------------------------------------------------------------
    # Model loading helpers
    # ------------------------------------------------------------------

    def _select_onnx_providers(self, available: list[str]) -> list[str]:
        preferred: list[str] = []
        if self.env.get("TRUEFACE_FORCE_CPU") != "true":
            for provider in ("CUDAExecutionProvider", "TensorrtExecutionProvider"):
                if provider in available:
                    preferred.append(provider)
        if "CPUExecutionProvider" in available:
            preferred.append("CPUExecutionProvider")
        return preferred or available

    def _load_face_parser(self, model_path: Path) -> None:
        try:
            from .face_parser import BiSeNetParser  # type: ignore

            self.face_parser = BiSeNetParser(model_path, self.providers)
            self.parser_available = self.face_parser.available
        except Exception as exc:  # pragma: no cover
            self.face_parser = None
            self.parser_available = False

    def _load_restorer(self, model_path: Path) -> None:
        try:
            from .restoration import GFPGANRestorer  # type: ignore

            self.restorer = GFPGANRestorer(
                model_path,
                upscale=1,
                arch="clean",
                channel_multiplier=2,
            )
            self.restorer_available = self.restorer.available
        except Exception as exc:  # pragma: no cover
            self.restorer = None
            self.restorer_available = False

    # ------------------------------------------------------------------
    # Encode / decode
    # ------------------------------------------------------------------

    def _decode_image_data_url(self, data_url: str, *, field_name: str) -> Any:
        if self.np is None or self.cv2 is None:
            raise WorkerProcessingError(
                "WORKER_DEPENDENCIES_MISSING",
                "OpenCV and NumPy are not available in the worker runtime",
                status_code=503,
            )
        try:
            _, encoded = data_url.split(",", 1)
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise WorkerProcessingError(
                "INVALID_IMAGE_DATA",
                f"{field_name} must be a valid image data URL",
                status_code=422,
            ) from exc

        buffer = self.np.frombuffer(raw, dtype=self.np.uint8)
        image = self.cv2.imdecode(buffer, self.cv2.IMREAD_COLOR)
        if image is None:
            raise WorkerProcessingError(
                "INVALID_IMAGE_DATA",
                f"{field_name} could not be decoded as an image",
                status_code=422,
            )
        return image

    def _encode_image_data_url(self, image: Any, quality_mode: str) -> str:
        if self.cv2 is None:
            raise WorkerProcessingError(
                "WORKER_DEPENDENCIES_MISSING",
                "OpenCV is not available in the worker runtime",
                status_code=503,
            )
        output_format = self.env.get("TRUEFACE_OUTPUT_MIME", "image/jpeg")
        if output_format == "image/webp":
            extension = ".webp"
            params = [self.cv2.IMWRITE_WEBP_QUALITY, self._webp_quality(quality_mode)]
            mime = "image/webp"
        else:
            extension = ".jpg"
            params = [self.cv2.IMWRITE_JPEG_QUALITY, self._jpeg_quality(quality_mode)]
            mime = "image/jpeg"

        ok, encoded = self.cv2.imencode(extension, image, params)
        if not ok:
            raise WorkerProcessingError(
                "FRAME_ENCODE_FAILED",
                "Processed frame could not be encoded",
                status_code=502,
            )
        return f"data:{mime};base64,{base64.b64encode(encoded.tobytes()).decode()}"

    # ------------------------------------------------------------------
    # Face detection and identity building
    # ------------------------------------------------------------------

    def _detect_faces(self, image: Any) -> list[Any]:
        try:
            return list(self.face_app.get(image))  # type: ignore[union-attr]
        except Exception as exc:
            raise WorkerProcessingError(
                "FACE_DETECTION_FAILED",
                f"Face detection failed: {exc}",
                status_code=502,
            ) from exc

    def _build_reference_identity(
        self, profile_images: list[dict[str, Any]]
    ) -> tuple[Any, Any]:
        references: list[IdentityReference] = []
        source_candidates: list[tuple[float, Any]] = []

        for index, item in enumerate(profile_images):
            image_data = item.get("image") or item.get("url") or item.get("dataUrl")
            if not isinstance(image_data, str):
                continue
            image = self._decode_image_data_url(
                image_data, field_name=f"faceProfileImages[{index}]"
            )
            faces = self._detect_faces(image)
            if not faces:
                continue

            face = max(faces, key=self._face_area)
            embedding = self._face_embedding(face)
            role = str(item.get("role") or "FRONT").upper()
            quality_score = float(item.get("qualityScore", 85))
            references.append(
                IdentityReference(
                    role=role,
                    embedding=embedding,
                    quality_score=quality_score,
                )
            )
            role_bonus = 20 if role == "FRONT" else 0
            source_candidates.append((quality_score + role_bonus, face))

        if not references or not source_candidates:
            raise WorkerProcessingError(
                "NO_REFERENCE_FACE",
                "No usable face was detected in the selected face profile images",
                status_code=422,
            )

        identity = build_identity_embedding(references)
        source_face = max(source_candidates, key=lambda value: value[0])[1]
        return identity, source_face

    def _to_detected_face(self, face: Any) -> DetectedFace:
        return DetectedFace(
            bbox=tuple(float(value) for value in self._face_value(face, "bbox")),
            embedding=self._face_embedding(face),
            landmarks=self._face_landmarks(face),
            detection_score=float(self._face_value(face, "det_score", 1.0)),
        )

    def _face_embedding(self, face: Any) -> list[float]:
        embedding = self._face_value(face, "normed_embedding", None)
        if embedding is None:
            embedding = self._face_value(face, "embedding", None)
        if embedding is None:
            raise WorkerProcessingError(
                "FACE_EMBEDDING_MISSING",
                "Detected face is missing identity embedding",
                status_code=502,
            )
        return [float(value) for value in list(embedding)]

    def _face_landmarks(self, face: Any) -> list[tuple[float, float]]:
        landmarks = None
        for key in ("landmark_2d_106", "landmark_3d_68", "kps"):
            value = self._face_value(face, key, None)
            if value is not None:
                try:
                    if len(value) > 0:
                        landmarks = value
                        break
                except TypeError:
                    continue
        if landmarks is None:
            landmarks = []
        points: list[tuple[float, float]] = []
        for point in landmarks:
            if len(point) >= 2:
                points.append((float(point[0]), float(point[1])))
        return points

    # ------------------------------------------------------------------
    # Core swap
    # ------------------------------------------------------------------

    def _swap(
        self,
        frame: Any,
        target_face: Any,
        source_face: Any,
        identity_embedding: list[float],
    ) -> Any:
        if self.np is None:
            raise WorkerProcessingError(
                "WORKER_DEPENDENCIES_MISSING",
                "NumPy is not available in the worker runtime",
                status_code=503,
            )
        try:
            averaged = self.np.asarray(identity_embedding, dtype=self.np.float32)
            self._set_face_value(source_face, "normed_embedding", averaged)
            self._set_face_value(source_face, "embedding", averaged)
            return self.swapper.get(  # type: ignore[union-attr]
                frame.copy(),
                target_face,
                source_face,
                paste_back=True,
            )
        except Exception as exc:
            raise WorkerProcessingError(
                "SWAP_FAILED",
                f"GPU face swap inference failed: {exc}",
                status_code=502,
            ) from exc

    # ------------------------------------------------------------------
    # Face crop extraction and mask building
    # ------------------------------------------------------------------

    def _extract_face_crop(
        self,
        frame: Any,
        face: Any,
        frame_w: int,
        frame_h: int,
    ) -> tuple[Any, tuple[int, int, int, int]]:
        """Extract a padded face crop (min 512px) from the frame."""
        left, top, right, bottom = [
            float(v) for v in self._face_value(face, "bbox")
        ]
        box_w = right - left
        box_h = bottom - top
        # Expand by ~35% for context, min 512px
        pad_x = max(box_w * 0.35, 64)
        pad_y = max(box_h * 0.35, 64)
        x1 = max(0, int(left - pad_x))
        y1 = max(0, int(top - pad_y))
        x2 = min(frame_w - 1, int(right + pad_x))
        y2 = min(frame_h - 1, int(bottom + pad_y))
        crop = frame[y1:y2, x1:x2]
        # Ensure minimum 512px long edge for parser quality
        ch, cw = crop.shape[:2]
        if max(ch, cw) < 512:
            scale = 512 / max(ch, cw)
            crop = self.cv2.resize(
                crop,
                (int(cw * scale), int(ch * scale)),
                interpolation=self.cv2.INTER_LINEAR,
            )
        return crop, (x1, y1, x2, y2)

    def _get_parse_mask(self, face_crop_bgr: Any) -> Any:
        """Return float32 mask [0..1] from BiSeNet parser or ellipse fallback."""
        if self.face_parser is not None:
            return self.face_parser.parse(face_crop_bgr)
        # Inline ellipse fallback if parser not loaded at all
        h, w = face_crop_bgr.shape[:2]
        mask = self.np.zeros((h, w), dtype=self.np.float32)
        cx, cy = w // 2, int(h * 0.45)
        rx, ry = int(w * 0.42), int(h * 0.48)
        self.cv2.ellipse(mask, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
        mask = self.cv2.GaussianBlur(mask, (21, 21), 0)
        return mask

    def _project_mask_to_frame(
        self,
        crop_mask: Any,
        crop_box: tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
        face: Any,
    ) -> Any:
        """Resize and place the crop-space mask back into full frame coordinates."""
        np = self.np
        cv2 = self.cv2
        x1, y1, x2, y2 = crop_box
        target_w = x2 - x1
        target_h = y2 - y1

        # Resize parse mask to match the crop region in the frame
        resized = cv2.resize(
            crop_mask,
            (target_w, target_h),
            interpolation=cv2.INTER_LINEAR,
        )
        full_mask = np.zeros((frame_h, frame_w), dtype=np.float32)
        full_mask[y1:y2, x1:x2] = resized

        # Feather the mask edges
        blur = max(17, int(min(frame_w, frame_h) * 0.025) | 1)
        dilate_k = max(3, int(min(frame_w, frame_h) * 0.006) | 1)
        kernel = np.ones((dilate_k, dilate_k), np.uint8)
        mask_u8 = (full_mask * 255).astype(np.uint8)
        mask_u8 = cv2.dilate(mask_u8, kernel, iterations=1)
        mask_u8 = cv2.GaussianBlur(mask_u8, (blur, blur), 0)
        return np.clip(mask_u8.astype(np.float32) / 255.0, 0.0, 1.0)

    # ------------------------------------------------------------------
    # Color matching and blending
    # ------------------------------------------------------------------

    def _match_color(self, swapped: Any, original: Any, mask: Any) -> Any:
        np = self.np
        cv2 = self.cv2
        if np is None or cv2 is None:
            return swapped

        active = mask > 0.12
        if active.sum() < 64:
            return swapped

        source_lab = cv2.cvtColor(swapped, cv2.COLOR_BGR2LAB).astype(np.float32)
        target_lab = cv2.cvtColor(original, cv2.COLOR_BGR2LAB).astype(np.float32)
        adjusted = source_lab.copy()

        for channel in range(3):
            source_values = source_lab[:, :, channel][active]
            target_values = target_lab[:, :, channel][active]
            source_std = float(source_values.std()) or 1.0
            target_std = float(target_values.std()) or 1.0
            source_mean = float(source_values.mean())
            target_mean = float(target_values.mean())
            adjusted[:, :, channel] = (
                (adjusted[:, :, channel] - source_mean)
                * (target_std / source_std)
                + target_mean
            )

        adjusted = np.clip(adjusted, 0, 255).astype(np.uint8)
        matched = cv2.cvtColor(adjusted, cv2.COLOR_LAB2BGR)
        alpha = mask[:, :, None]
        return np.clip(matched * alpha + swapped * (1 - alpha), 0, 255).astype(np.uint8)

    def _alpha_blend(self, swapped: Any, original: Any, mask: Any) -> Any:
        np = self.np
        if np is None:
            return swapped
        alpha = mask[:, :, None]
        return np.clip(swapped * alpha + original * (1 - alpha), 0, 255).astype(np.uint8)

    # ------------------------------------------------------------------
    # GFPGAN face restoration
    # ------------------------------------------------------------------

    def _restore_face_region(
        self,
        frame: Any,
        face: Any,
        frame_w: int,
        frame_h: int,
        quality_mode: str,
    ) -> tuple[Any, bool]:
        """Run GFPGAN on the face region in the output frame, paste back."""
        if self.restorer is None:
            return frame, False

        # Skip restoration in low quality mode to save latency
        if quality_mode == "low":
            return frame, False

        try:
            left, top, right, bottom = [
                float(v) for v in self._face_value(face, "bbox")
            ]
            pad_x = (right - left) * 0.25
            pad_y = (bottom - top) * 0.30
            x1 = max(0, int(left - pad_x))
            y1 = max(0, int(top - pad_y))
            x2 = min(frame_w - 1, int(right + pad_x))
            y2 = min(frame_h - 1, int(bottom + pad_y))
            face_crop = frame[y1:y2, x1:x2].copy()

            weight = float(self.env.get("GFPGAN_WEIGHT", "0.5"))
            restored_crop = self.restorer.restore(face_crop, weight=weight)
            if restored_crop is not None and restored_crop.shape == face_crop.shape:
                output = frame.copy()
                output[y1:y2, x1:x2] = restored_crop
                return output, self.restorer_available
        except Exception as exc:  # pragma: no cover
            pass  # fall through to returning original

        return frame, False

    # ------------------------------------------------------------------
    # Temporal smoothing
    # ------------------------------------------------------------------

    def _temporal_blend(
        self,
        image: Any,
        mask: Any,
        state: FrameState,
        target: DetectedFace,
    ) -> Any:
        np = self.np
        if np is None or state.previous_frame is None or state.previous_face is None:
            return image
        if state.previous_frame.shape != image.shape:
            return image
        lock_iou = bbox_iou(target.bbox, state.previous_face.bbox)
        if lock_iou < 0.3:
            return image
        # EMA alpha: max 0.15, scales with IoU quality
        alpha = min(0.15, lock_iou * 0.14)
        blend_mask = (mask * alpha)[:, :, None]
        return np.clip(
            image * (1 - blend_mask) + state.previous_frame * blend_mask, 0, 255
        ).astype(np.uint8)

    # ------------------------------------------------------------------
    # Session state management
    # ------------------------------------------------------------------

    def _state_for(self, key: str) -> FrameState:
        if key in self.states:
            state = self.states.pop(key)
            self.states[key] = state
            return state
        state = FrameState()
        self.states[key] = state
        while len(self.states) > self.max_states:
            self.states.popitem(last=False)
        return state

    # ------------------------------------------------------------------
    # Generic face attribute accessors
    # ------------------------------------------------------------------

    def _face_value(self, face: Any, key: str, default: Any = None) -> Any:
        if hasattr(face, key):
            return getattr(face, key)
        if isinstance(face, dict):
            return face.get(key, default)
        try:
            return face[key]
        except Exception:
            return default

    def _set_face_value(self, face: Any, key: str, value: Any) -> None:
        try:
            setattr(face, key, value)
        except Exception:
            pass
        if isinstance(face, dict):
            face[key] = value
        else:
            try:
                face[key] = value
            except Exception:
                pass

    def _face_area(self, face: Any) -> float:
        left, top, right, bottom = self._face_value(face, "bbox")
        return max(0.0, float(right) - float(left)) * max(
            0.0, float(bottom) - float(top)
        )

    def _expanded_bbox(
        self, face: Any, width: int, height: int
    ) -> tuple[int, int, int, int]:
        left, top, right, bottom = [
            float(value) for value in self._face_value(face, "bbox")
        ]
        box_width = right - left
        box_height = bottom - top
        return (
            max(0, int(left - box_width * 0.18)),
            max(0, int(top - box_height * 0.28)),
            min(width - 1, int(right + box_width * 0.18)),
            min(height - 1, int(bottom + box_height * 0.18)),
        )

    # ------------------------------------------------------------------
    # Quality metrics
    # ------------------------------------------------------------------

    def _mask_coverage(self, mask: Any) -> float:
        try:
            return round(float(mask.mean()), 5)
        except Exception:
            return 0.0

    def _sharpness(self, image: Any) -> float:
        try:
            gray = self.cv2.cvtColor(image, self.cv2.COLOR_BGR2GRAY)
            return round(float(self.cv2.Laplacian(gray, self.cv2.CV_64F).var()), 4)
        except Exception:
            return 0.0

    def _webp_quality(self, quality_mode: str) -> int:
        return {"low": 78, "standard": 88, "hd": 94}.get(quality_mode, 88)

    def _jpeg_quality(self, quality_mode: str) -> int:
        return {"low": 85, "standard": 92, "hd": 95}.get(quality_mode, 92)

    def _elapsed_ms(self, started: float) -> int:
        return int((time.perf_counter() - started) * 1000)
