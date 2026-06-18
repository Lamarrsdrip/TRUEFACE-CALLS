"""
Face restoration module — GFPGAN v1.4 with CodeFormer fallback.
Applied to every swapped face to recover detail lost in the 128px inswapper pass.
This is the single biggest quality improvement over the base pipeline.
"""
from __future__ import annotations

import numpy as np
import cv2
from pathlib import Path
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class GFPGANRestorer:
    def __init__(
        self,
        model_path: Path,
        upscale: int = 1,
        arch: str = "clean",
        channel_multiplier: int = 2,
    ):
        self.restorer = None
        self.available = False
        self.upscale = upscale

        if not model_path.exists():
            logger.warning(
                f"GFPGAN model not found at {model_path} — using opencv sharpening fallback"
            )
            return

        try:
            from gfpgan import GFPGANer  # type: ignore

            self.restorer = GFPGANer(
                model_path=str(model_path),
                upscale=upscale,
                arch=arch,
                channel_multiplier=channel_multiplier,
                bg_upsampler=None,  # no background upscaling for speed
            )
            self.available = True
            logger.info(f"GFPGAN loaded from {model_path}")
        except Exception as e:
            logger.warning(f"GFPGAN load failed: {e} — using opencv sharpening fallback")

    def restore(self, face_bgr: np.ndarray, weight: float = 0.5) -> np.ndarray:
        """
        Restore/enhance a face crop. weight=1.0 = full GFPGAN, 0.0 = original.
        Returns same size as input (upscale=1 keeps resolution).
        """
        if self.available and self.restorer is not None:
            try:
                _, _, restored = self.restorer.enhance(
                    face_bgr,
                    has_aligned=False,
                    only_center_face=True,
                    paste_back=True,
                    weight=weight,
                )
                if restored is not None:
                    if restored.shape[:2] != face_bgr.shape[:2]:
                        restored = cv2.resize(
                            restored, (face_bgr.shape[1], face_bgr.shape[0])
                        )
                    return restored
            except Exception as e:
                logger.warning(f"GFPGAN enhance failed: {e}")

        # Fallback: unsharp mask + CLAHE
        return self._opencv_sharpen(face_bgr)

    def _opencv_sharpen(self, img: np.ndarray) -> np.ndarray:
        blurred = cv2.GaussianBlur(img, (0, 0), 3)
        sharpened = cv2.addWeighted(img, 1.5, blurred, -0.5, 0)
        lab = cv2.cvtColor(sharpened, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
