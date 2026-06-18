import base64
from datetime import timedelta

from fastapi.testclient import TestClient
from gridfs import GridFS

from backend.app.serializers import utc_now
from backend.app.vault import SecretVault
from backend.server import create_app

from .test_product_flows import csrf, signup


FRAME_BYTES = b"\xff\xd8\xff" + b"\x00" * 64
FRAME = "data:image/jpeg;base64," + base64.b64encode(FRAME_BYTES).decode()


def configure_gpu(mongo_db, master_key):
    vault = SecretVault(master_key)
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "gpu",
            "publicValue": {
                "provider": "custom",
                "endpoint": "https://gpu.example/process",
                "timeoutSeconds": "8",
                "fallbackMode": "local",
            },
            "encryptedValue": {"apiKey": vault.encrypt("gpu-secret")},
            "secretFingerprint": {
                "apiKey": vault.fingerprint("gpu-secret"),
            },
        }
    )


def add_authorized_media_context(mongo_db, user_id):
    now = utc_now()
    object_key = f"faces/{user_id}/front"
    side_key = f"faces/{user_id}/left"
    GridFS(mongo_db, collection="uploads").put(
        FRAME_BYTES,
        filename=object_key,
        contentType="image/jpeg",
    )
    GridFS(mongo_db, collection="uploads").put(
        FRAME_BYTES,
        filename=side_key,
        contentType="image/jpeg",
    )
    mongo_db.face_profiles.insert_one(
        {
            "id": "face-1",
            "userId": user_id,
            "objectKey": object_key,
            "mimeType": "image/jpeg",
            "active": True,
            "moderationStatus": "APPROVED",
            "consentRevokedAt": None,
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
    )
    mongo_db.face_profile_images.insert_many(
        [
            {
                "id": "face-image-front",
                "faceProfileId": "face-1",
                "objectKey": object_key,
                "role": "FRONT",
                "mimeType": "image/jpeg",
                "qualityScore": 100,
                "width": 1024,
                "height": 1024,
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "id": "face-image-left",
                "faceProfileId": "face-1",
                "objectKey": side_key,
                "role": "LEFT",
                "mimeType": "image/jpeg",
                "qualityScore": 100,
                "width": 1024,
                "height": 1024,
                "createdAt": now,
                "updatedAt": now,
            },
        ]
    )
    mongo_db.call_rooms.insert_one(
        {
            "id": "room-1",
            "hostId": user_id,
            "slug": "room-1",
            "title": "Cloud room",
            "status": "OPEN",
            "inviteVersion": 1,
            "waitingRoom": False,
            "allowGuests": True,
            "maxParticipants": 2,
            "expiresAt": now + timedelta(hours=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    mongo_db.call_participants.insert_one(
        {
            "id": "participant-1",
            "roomId": "room-1",
            "userId": user_id,
            "role": "HOST",
            "state": "JOINED",
            "createdAt": now,
            "updatedAt": now,
        }
    )


def test_provider_health_reports_local_fallback_when_gpu_missing(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)

    response = client.get("/api/ai/face/provider-health")

    assert response.status_code == 200
    assert response.json()["effectiveMode"] == "local"
    assert response.json()["local"]["available"] is True
    assert response.json()["cloud"]["available"] is False
    assert response.json()["cloud"]["reason"] == "GPU provider not configured"


def test_process_frame_requires_room_participation(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    add_authorized_media_context(mongo_db, user["id"])
    mongo_db.call_participants.delete_many({})
    configure_gpu(mongo_db, master_key)

    response = client.post(
        "/api/ai/face/process-frame",
        headers=headers,
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "frameMetadata": {
                "width": 960,
                "height": 540,
                "mimeType": "image/webp",
                "byteLength": 120_000,
            },
            "qualityMode": "standard",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 403
    assert response.json()["code"] == "ROOM_PARTICIPATION_REQUIRED"


def test_process_frame_rejects_invalid_frame_before_worker_call(
    mongo_db, master_key, monkeypatch
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    add_authorized_media_context(mongo_db, user["id"])
    configure_gpu(mongo_db, master_key)
    calls = []
    monkeypatch.setattr(
        "backend.app.ai_providers.httpx.post",
        lambda *_args, **_kwargs: calls.append(True),
    )

    response = client.post(
        "/api/ai/face/process-frame",
        headers=headers,
        json={
            "frame": "data:text/plain;base64,SGVsbG8=",
            "faceProfileId": "face-1",
            "qualityMode": "standard",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_VIDEO_FRAME"
    assert calls == []


def test_process_frame_calls_normalized_gpu_worker(
    mongo_db, master_key, monkeypatch
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    add_authorized_media_context(mongo_db, user["id"])
    configure_gpu(mongo_db, master_key)
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "processedFrame": FRAME,
                "latencyMs": 123,
                "providerStatus": "OPERATIONAL",
                "capabilities": {
                    "realtime": True,
                    "photorealistic": False,
                },
            }

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr("backend.app.ai_providers.httpx.post", fake_post)

    response = client.post(
        "/api/ai/face/process-frame",
        headers=headers,
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "frameMetadata": {
                "width": 960,
                "height": 540,
                "mimeType": "image/webp",
                "byteLength": 120_000,
            },
            "qualityMode": "standard",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "processedFrame": FRAME,
        "latencyMs": 123,
        "providerStatus": "OPERATIONAL",
    }
    assert captured["url"] == "https://gpu.example/process"
    assert captured["headers"]["Authorization"] == "Bearer gpu-secret"
    assert captured["json"]["frame"] == FRAME
    assert captured["json"]["faceProfileId"] == "face-1"
    assert captured["json"]["faceProfileImage"].startswith(
        "data:image/jpeg;base64,"
    )
    assert captured["json"]["faceProfileImages"] == [
        {
            "id": "face-image-front",
            "role": "FRONT",
            "image": captured["json"]["faceProfileImage"],
            "mimeType": "image/jpeg",
            "qualityScore": 100,
            "width": 1024,
            "height": 1024,
        },
        {
            "id": "face-image-left",
            "role": "LEFT",
            "image": captured["json"]["faceProfileImages"][1]["image"],
            "mimeType": "image/jpeg",
            "qualityScore": 100,
            "width": 1024,
            "height": 1024,
        },
    ]
    assert captured["json"]["frameMetadata"] == {
        "width": 960,
        "height": 540,
        "mimeType": "image/jpeg",
        "byteLength": len(FRAME_BYTES),
    }
    assert captured["json"]["qualityHints"] == {
        "preserveDetail": True,
        "temporalStability": True,
        "targetMaxLongEdge": 960,
    }
    assert "gpu-secret" not in str(captured["json"])


def test_process_frame_returns_specific_worker_failure(
    mongo_db, master_key, monkeypatch
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    add_authorized_media_context(mongo_db, user["id"])
    configure_gpu(mongo_db, master_key)

    def fail(*_args, **_kwargs):
        raise TimeoutError("secret upstream detail")

    monkeypatch.setattr("backend.app.ai_providers.httpx.post", fail)

    response = client.post(
        "/api/ai/face/process-frame",
        headers=headers,
        json={
            "frame": FRAME,
            "faceProfileId": "face-1",
            "qualityMode": "hd",
            "roomId": "room-1",
        },
    )

    assert response.status_code == 502
    assert response.json()["code"] == "GPU_INFERENCE_FAILED"
    assert "secret upstream detail" not in response.json()["message"]


def test_face_quality_uses_emergent_llm_with_metadata_only(
    mongo_db, master_key, monkeypatch
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    vault = SecretVault(master_key)
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "ai",
            "publicValue": {
                "enabled": "true",
                "provider": "emergent",
                "mode": "hybrid",
                "gatewayUrl": "https://llm.example",
            },
            "encryptedValue": {
                "universalKey": vault.encrypt("llm-secret"),
            },
            "secretFingerprint": {
                "universalKey": vault.fingerprint("llm-secret"),
            },
        }
    )
    captured = {}

    def complete(_self, **kwargs):
        captured.update(kwargs)
        return {
            "summary": "Good front-facing image",
            "recommendations": ["Add a slight side angle"],
        }

    monkeypatch.setattr(
        "backend.app.routers.faces.EmergentLlmClient.complete_json",
        complete,
    )
    response = client.post(
        "/api/faces/quality-check",
        headers=headers,
        json={
            "width": 1024,
            "height": 1024,
            "faceCount": 1,
            "sharpness": 0.8,
            "brightness": 0.6,
            "faceCoverage": 0.4,
            "frame": FRAME,
        },
    )

    assert response.status_code == 200
    assert response.json()["aiGuidance"]["summary"] == "Good front-facing image"
    assert "frame" not in captured["payload"]
    assert captured["payload"]["deterministicScore"] == 100


def test_admin_ai_diagnostics_uses_llm_for_provider_recommendation(
    mongo_db, master_key, monkeypatch
):
    from .test_provider_configuration import logged_in_admin

    client, headers = logged_in_admin(mongo_db, master_key)
    client.put(
        "/api/admin/providers/ai",
        headers=headers,
        json={
            "values": {
                "enabled": "true",
                "provider": "emergent",
                "mode": "hybrid",
                "gatewayUrl": "https://llm.example",
                "universalKey": "llm-secret",
            }
        },
    )

    def complete(_self, **kwargs):
        assert kwargs["payload"]["localAvailable"] is True
        assert "apiKey" not in str(kwargs["payload"])
        return {
            "recommendedMode": "local",
            "summary": "Use local processing until a GPU worker is healthy.",
            "actions": ["Configure and test the GPU worker."],
        }

    monkeypatch.setattr(
        "backend.app.routers.providers.EmergentLlmClient.complete_json",
        complete,
    )
    response = client.post(
        "/api/admin/providers/ai/diagnostics",
        headers=headers,
        json={},
    )

    assert response.status_code == 200
    assert response.json()["recommendedMode"] == "local"
