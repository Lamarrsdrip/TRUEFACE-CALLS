from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Iterable, Sequence


@dataclass(frozen=True)
class IdentityReference:
    role: str
    embedding: Sequence[float]
    quality_score: float = 100.0


@dataclass(frozen=True)
class IdentityEmbedding:
    embedding: list[float]
    reference_count: int
    roles: list[str]


@dataclass(frozen=True)
class DetectedFace:
    bbox: tuple[float, float, float, float]
    embedding: Sequence[float]
    landmarks: Sequence[tuple[float, float]]
    detection_score: float = 1.0


ROLE_WEIGHTS = {
    "FRONT": 1.35,
    "LEFT": 1.0,
    "RIGHT": 1.0,
    "LIGHTING": 0.85,
    "EXPRESSION": 0.8,
}


def normalize_vector(values: Sequence[float]) -> list[float]:
    magnitude = sqrt(sum(float(value) * float(value) for value in values))
    if magnitude <= 0:
        raise ValueError("Embedding magnitude is zero")
    return [float(value) / magnitude for value in values]


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    try:
        normalized_left = normalize_vector(left)
        normalized_right = normalize_vector(right)
    except ValueError:
        return 0.0
    return sum(
        left_value * right_value
        for left_value, right_value in zip(normalized_left, normalized_right)
    )


def build_identity_embedding(
    references: Iterable[IdentityReference],
) -> IdentityEmbedding:
    weighted_sum: list[float] | None = None
    total_weight = 0.0
    roles: list[str] = []
    count = 0

    for reference in references:
        embedding = normalize_vector(reference.embedding)
        if weighted_sum is None:
            weighted_sum = [0.0 for _ in embedding]
        if len(weighted_sum) != len(embedding):
            raise ValueError("All identity embeddings must have the same length")
        role = reference.role.upper()
        quality_weight = max(0.1, min(float(reference.quality_score), 100.0)) / 100
        weight = ROLE_WEIGHTS.get(role, 0.75) * quality_weight
        for index, value in enumerate(embedding):
            weighted_sum[index] += value * weight
        total_weight += weight
        roles.append(role)
        count += 1

    if weighted_sum is None or total_weight <= 0:
        raise ValueError("At least one valid identity reference is required")

    averaged = [value / total_weight for value in weighted_sum]
    return IdentityEmbedding(
        embedding=normalize_vector(averaged),
        reference_count=count,
        roles=roles,
    )


def bbox_area(bbox: tuple[float, float, float, float]) -> float:
    left, top, right, bottom = bbox
    return max(0.0, right - left) * max(0.0, bottom - top)


def bbox_iou(
    left_bbox: tuple[float, float, float, float],
    right_bbox: tuple[float, float, float, float],
) -> float:
    left = max(left_bbox[0], right_bbox[0])
    top = max(left_bbox[1], right_bbox[1])
    right = min(left_bbox[2], right_bbox[2])
    bottom = min(left_bbox[3], right_bbox[3])
    intersection = bbox_area((left, top, right, bottom))
    union = bbox_area(left_bbox) + bbox_area(right_bbox) - intersection
    return intersection / union if union > 0 else 0.0


def select_stable_target(
    faces: Sequence[DetectedFace],
    *,
    previous_face: DetectedFace | None,
    identity_embedding: Sequence[float] | None,
) -> DetectedFace:
    if not faces:
        raise ValueError("No faces detected")

    def score(face: DetectedFace) -> float:
        area_score = min(1.0, bbox_area(face.bbox) / 250_000.0) * 0.15
        detection_score = max(0.0, min(face.detection_score, 1.0)) * 0.2
        lock_score = (
            bbox_iou(face.bbox, previous_face.bbox) * 0.45
            if previous_face
            else 0.0
        )
        identity_score = (
            max(0.0, cosine_similarity(face.embedding, identity_embedding)) * 0.2
            if identity_embedding
            else 0.0
        )
        return area_score + detection_score + lock_score + identity_score

    return max(faces, key=score)


@dataclass
class TemporalColor:
    brightness: float = 1.0
    contrast: float = 1.0
    warmth: float = 0.0


class ExponentialSmoother:
    def __init__(self, alpha: float):
        self.alpha = max(0.01, min(alpha, 1.0))
        self.value: TemporalColor | None = None

    def update(self, value: TemporalColor) -> TemporalColor:
        if self.value is None:
            self.value = value
            return value
        next_value = TemporalColor(
            brightness=_lerp(self.value.brightness, value.brightness, self.alpha),
            contrast=_lerp(self.value.contrast, value.contrast, self.alpha),
            warmth=_lerp(self.value.warmth, value.warmth, self.alpha),
        )
        self.value = next_value
        return next_value


def _lerp(start: float, end: float, alpha: float) -> float:
    return start + (end - start) * alpha
