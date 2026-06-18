"""
BiSeNet face parser — 19-class semantic face segmentation.
Replaces convex-hull mask with pixel-level face region mask.
Face classes used for swap region: 1(skin) 2(l_brow) 3(r_brow) 4(l_eye) 5(r_eye)
  10(nose) 11(mouth) 12(u_lip) 13(l_lip) — excludes hair(17), background(0), neck(14)
"""
from __future__ import annotations

import numpy as np
import cv2
from pathlib import Path
import onnxruntime as ort
from typing import Optional

FACE_PARSE_CLASSES = {1, 2, 3, 4, 5, 6, 10, 11, 12, 13}  # face skin + features
INCLUDE_EARS = {7, 8, 9}  # optional: include ears for jaw coverage


class BiSeNetParser:
    def __init__(self, model_path: Path, providers: list):
        self.session: Optional[ort.InferenceSession] = None
        self.available = False
        if not model_path.exists():
            return
        try:
            self.session = ort.InferenceSession(str(model_path), providers=providers)
            self.input_name = self.session.get_inputs()[0].name
            self.available = True
        except Exception as e:
            pass  # graceful fallback to convex hull

    def parse(self, face_crop_bgr: np.ndarray) -> np.ndarray:
        """
        Returns float32 mask [0..1] same size as face_crop_bgr.
        1.0 = face region to swap, 0.0 = preserve original.
        Falls back to ellipse mask if model not available.
        """
        if not self.available or self.session is None:
            return self._ellipse_fallback(face_crop_bgr)

        h, w = face_crop_bgr.shape[:2]
        # Resize to 512x512 for BiSeNet
        inp = cv2.resize(face_crop_bgr, (512, 512))
        inp = cv2.cvtColor(inp, cv2.COLOR_BGR2RGB).astype(np.float32)
        inp = (inp / 127.5) - 1.0
        inp = np.transpose(inp, (2, 0, 1))[np.newaxis]

        output = self.session.run(None, {self.input_name: inp})[0]  # (1, 19, 512, 512)
        seg = np.argmax(output[0], axis=0).astype(np.uint8)  # (512, 512)

        # Build mask from face classes
        mask = np.zeros((512, 512), dtype=np.uint8)
        for cls in FACE_PARSE_CLASSES | INCLUDE_EARS:
            mask[seg == cls] = 255

        # Smooth mask edges
        mask = cv2.GaussianBlur(mask, (15, 15), 0)
        mask = cv2.resize(mask, (w, h))
        return mask.astype(np.float32) / 255.0

    def _ellipse_fallback(self, face_crop_bgr: np.ndarray) -> np.ndarray:
        h, w = face_crop_bgr.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)
        cx, cy = w // 2, int(h * 0.45)
        rx, ry = int(w * 0.42), int(h * 0.48)
        cv2.ellipse(mask, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
        mask = cv2.GaussianBlur(mask, (21, 21), 0)
        return mask
