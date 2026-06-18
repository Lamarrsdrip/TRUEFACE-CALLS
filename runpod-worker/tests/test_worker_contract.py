import base64
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from trueface_worker.app import create_app
from trueface_worker.errors import WorkerProcessingError
from trueface_worker.pipeline import (
    DetectedFace,
    IdentityReference,
    build_identity_embedding,
    select_stable_target,
)


FRAME = "data:image/jpeg;base64," + base64.b64encode(
    b"\xff\xd8\xff" + b"\x11" * 64
).decode()
PROCESSED = "data:image/jpeg;base64," + base64.b64encode(
    b"\xff\xd8\xff" + b"\x22" * 64
).decode()


def test_build_identity_embedding_uses_all_reference_faces():
    identity = build_identity_embedding(
        [
            IdentityReference(
                role="FRONT",
                embedding=[1.0, 0.0, 0.0],
                quality_score=100,
            ),
            IdentityReference(
                role="LEFT",
                embedding=[0.0, 1.0, 0.0],
                quality_score=80,
            ),
            IdentityReference(
                role="EXPRESSION",
                embedding=[0.0, 0.0, 1.0],
                quality_score=60,
            ),
        ]
    )

    assert identity.reference_count == 3
    assert identity.roles == ["FRONT", "LEFT", "EXPRESSION"]
    assert identity.embedding[0] > identity.embedding[1] > identity.embedding[2]
    assert round(sum(value * value for value in identity.embedding), 6) == 1.0


def test_select_stable_target_keeps_face_lock_over_largest_distractor():
    previous = DetectedFace(
        bbox=(100.0, 100.0, 220.0, 240.0),
        embedding=[1.0, 0.0, 0.0],
        landmarks=[(120.0, 130.0), (200.0, 130.0)],
        detection_score=0.96,
    )
    locked_face = DetectedFace(
        bbox=(108.0, 103.0, 226.0, 243.0),
        embedding=[0.99, 0.01, 0.0],
        landmarks=[(126.0, 134.0), (204.0, 133.0)],
        detection_score=0.93,
    )
    large_distractor = DetectedFace(
        bbox=(10.0, 20.0, 410.0, 460.0),
        embedding=[0.0, 1.0, 0.0],
        landmarks=[(80.0, 110.0), (330.0, 120.0)],
        detection_score=0.98,
    )

    selected = select_stable_target(
        [large_distractor, locked_face],
        previous_face=previous,
        identity_embedding=[1.0, 0.0, 0.0],
    )

    assert selected is locked_face


class FakeRealismEngine:
    def health(self):
        return {
            "modelsLoaded": True,
            "providers": ["CUDAExecutionProvider"],
            "device": "NVIDIA A40",
            "capabilities": {
                "multiReferenceIdentity": True,
                "temporalSmoothing": True,
                "restoration": "fake-test-restorer",
            },
        }

    def process(self, payload):
        assert payload["faceProfileImages"][0]["role"] == "FRONT"
        assert payload["qualityHints"]["preserveDetail"] is True
        return {
            "processedFrame": PROCESSED,
            "latencyMs": 41,
            "providerStatus": "OPERATIONAL",
            "capabilities": self.health()["capabilities"],
            "metrics": {
                "referenceCount": len(payload["faceProfileImages"]),
                "targetLocked": True,
                "passThrough": False,
            },
        }


def test_process_frame_contract_is_not_pass_through_and_reports_metrics():
    client = TestClient(
        create_app(engine=FakeRealismEngine(), api_key="test-secret")
    )

    response = client.post(
        "/process-frame",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "faceProfileImage": FRAME,
            "faceProfileImages": [
                {
                    "role": "FRONT",
                    "image": FRAME,
                    "qualityScore": 100,
                },
                {
                    "role": "LEFT",
                    "image": FRAME,
                    "qualityScore": 80,
                },
            ],
            "qualityMode": "hd",
            "qualityHints": {
                "preserveDetail": True,
                "temporalStability": True,
                "targetMaxLongEdge": 1280,
            },
            "roomId": "room-1",
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["processedFrame"] == PROCESSED
    assert body["processedFrame"] != FRAME
    assert body["metrics"]["referenceCount"] == 2
    assert body["metrics"]["targetLocked"] is True
    assert body["metrics"]["passThrough"] is False


def test_process_frame_rejects_missing_auth_when_key_is_configured():
    client = TestClient(
        create_app(engine=FakeRealismEngine(), api_key="test-secret")
    )

    response = client.post(
        "/process-frame",
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "faceProfileImages": [{"role": "FRONT", "image": FRAME}],
            "qualityMode": "hd",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 401


class FailingEngine:
    def health(self):
        return {"modelsLoaded": False}

    def process(self, payload):
        raise WorkerProcessingError(
            "FACE_NOT_DETECTED",
            "No usable face was detected in the live frame",
            status_code=422,
        )


def test_process_frame_returns_clear_worker_error_instead_of_generic_500():
    client = TestClient(create_app(engine=FailingEngine(), api_key="test-secret"))

    response = client.post(
        "/process-frame",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "faceProfileImages": [{"role": "FRONT", "image": FRAME}],
            "qualityMode": "hd",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "FACE_NOT_DETECTED",
            "message": "No usable face was detected in the live frame",
        }
    }
