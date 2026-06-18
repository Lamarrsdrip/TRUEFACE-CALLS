"""
CinematicEngine — InstantID + SDXL-Turbo full appearance transformation.
Transforms the target person to look like the reference identity entirely.
Preserves: pose, expression, head angle, lighting direction.
Changes: face, skin, hair, general appearance.
Latency: ~2-4s on A100 80GB. Not real-time — used for snapshot/filter mode.

Pipeline:
  target frame → ControlNet (depth + openpose) → SDXL Turbo (LCM 4 steps)
                                                    ↑
  reference images → InsightFace embedding → InstantID IP-Adapter
"""
from __future__ import annotations

import numpy as np
import cv2
import base64
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
import threading

logger = logging.getLogger(__name__)


class CinematicEngine:
    def __init__(self, models_dir: Path = Path("/models/cinematic")):
        self.models_dir = models_dir
        self.pipe = None
        self.face_app = None
        self.available = False
        self.load_error: Optional[str] = None
        self._lock = threading.Lock()
        self._load_models()

    def _load_models(self):
        try:
            import torch
            from diffusers import LCMScheduler
            from insightface.app import FaceAnalysis

            # Check all required model files exist
            instantid_path = self.models_dir / "ip-adapter.bin"
            controlnet_path = self.models_dir / "ControlNetModel"
            sdxl_path = self.models_dir / "sdxl-base-1.0"

            if not instantid_path.exists():
                self.load_error = f"InstantID ip-adapter not found at {instantid_path}"
                logger.warning(self.load_error)
                return
            if not sdxl_path.exists():
                self.load_error = f"SDXL base model not found at {sdxl_path}"
                logger.warning(self.load_error)
                return

            # Face encoder for reference identity
            self.face_app = FaceAnalysis(
                name="buffalo_l",
                root=str(self.models_dir / "insightface"),
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
            self.face_app.prepare(ctx_id=0, det_size=(640, 640))

            # Load InstantID pipeline
            from pipeline_stable_diffusion_xl_instantid import (  # type: ignore
                StableDiffusionXLInstantIDPipeline,
            )
            from diffusers import ControlNetModel

            controlnet = ControlNetModel.from_pretrained(
                str(controlnet_path),
                torch_dtype=torch.float16,
            )
            self.pipe = StableDiffusionXLInstantIDPipeline.from_pretrained(
                str(sdxl_path),
                controlnet=controlnet,
                torch_dtype=torch.float16,
                variant="fp16",
            ).to("cuda")

            # Load LCM LoRA for 4-step fast inference
            lcm_lora_path = self.models_dir / "lcm-lora-sdxl.safetensors"
            if lcm_lora_path.exists():
                self.pipe.load_lora_weights(str(lcm_lora_path))
                self.pipe.fuse_lora()
                self.pipe.scheduler = LCMScheduler.from_config(
                    self.pipe.scheduler.config
                )

            # Load InstantID face adapter
            self.pipe.load_ip_adapter_instantid(str(instantid_path))
            self.pipe.set_ip_adapter_scale(0.8)

            # Warmup
            self.pipe.enable_model_cpu_offload()
            self.pipe.enable_xformers_memory_efficient_attention()

            self.available = True
            logger.info("CinematicEngine ready — InstantID + SDXL LCM loaded")

        except ImportError as e:
            self.load_error = (
                f"Missing dependency: {e}. Install requirements-cinematic.txt."
            )
            logger.warning(self.load_error)
        except Exception as e:
            self.load_error = str(e)
            logger.error(f"CinematicEngine load failed: {e}")

    def _extract_face_embedding(self, image_bgr: np.ndarray):
        faces = self.face_app.get(image_bgr)
        if not faces:
            return None
        face = sorted(faces, key=lambda f: f.det_score, reverse=True)[0]
        return face

    def _decode_data_url(self, data_url: str) -> np.ndarray:
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        raw = base64.b64decode(data_url)
        arr = np.frombuffer(raw, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)

    def _encode_frame(self, frame_bgr: np.ndarray, quality: int = 92) -> str:
        ok, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if not ok:
            raise RuntimeError("Frame encode failed")
        b64 = base64.b64encode(buf.tobytes()).decode()
        return f"data:image/jpeg;base64,{b64}"

    def process(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.available or self.pipe is None:
            raise RuntimeError(self.load_error or "CinematicEngine not loaded")

        t0 = time.perf_counter()

        target_frame = self._decode_data_url(payload["frame"])
        profile_images = payload.get("faceProfileImages", [])
        quality_mode = payload.get("qualityMode", "standard")

        if not profile_images:
            raise ValueError("faceProfileImages required for cinematic mode")

        # Extract face embeddings from reference images
        face_info = None
        for img_rec in profile_images:
            ref_img = self._decode_data_url(img_rec["image"])
            face_info = self._extract_face_embedding(ref_img)
            if face_info is not None:
                break

        if face_info is None:
            raise ValueError("No face detected in any reference image")

        # Prepare target frame as PIL Image
        from PIL import Image

        target_rgb = cv2.cvtColor(target_frame, cv2.COLOR_BGR2RGB)
        target_pil = Image.fromarray(target_rgb)

        h, w = target_frame.shape[:2]
        long_edge = {"low": 512, "standard": 768, "hd": 1024}.get(quality_mode, 768)
        scale = long_edge / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        # Round to multiple of 8
        new_w = (new_w // 8) * 8
        new_h = (new_h // 8) * 8
        target_pil = target_pil.resize((new_w, new_h))

        num_steps = {"low": 4, "standard": 6, "hd": 8}.get(quality_mode, 6)
        guidance = 0.0  # LCM needs guidance=0 for speed

        with self._lock:
            result_images = self.pipe(
                prompt="a photorealistic person, natural skin, high quality, sharp, detailed face",
                negative_prompt="blurry, cartoon, artificial, distorted, low quality",
                image_embeds=face_info.normed_embedding,
                image=target_pil,
                controlnet_conditioning_scale=0.8,
                num_inference_steps=num_steps,
                guidance_scale=guidance,
                width=new_w,
                height=new_h,
            ).images

        result_pil = result_images[0]
        result_rgb = np.array(result_pil)
        result_bgr = cv2.cvtColor(result_rgb, cv2.COLOR_RGB2BGR)

        # Resize back to original dimensions
        if result_bgr.shape[:2] != (h, w):
            result_bgr = cv2.resize(
                result_bgr, (w, h), interpolation=cv2.INTER_LANCZOS4
            )

        q = {"low": 85, "standard": 92, "hd": 95}.get(quality_mode, 92)
        processed_frame = self._encode_frame(result_bgr, quality=q)
        latency_ms = int((time.perf_counter() - t0) * 1000)

        return {
            "processedFrame": processed_frame,
            "latencyMs": latency_ms,
            "mode": "cinematic",
            "steps": num_steps,
            "resolution": f"{new_w}x{new_h}",
        }

    def health(self) -> Dict[str, Any]:
        return {
            "available": self.available,
            "loadError": self.load_error,
            "mode": "cinematic/instantid-sdxl-lcm",
        }
