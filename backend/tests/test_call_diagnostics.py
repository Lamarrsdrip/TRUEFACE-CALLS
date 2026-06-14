from datetime import timedelta

from fastapi.testclient import TestClient

from backend.app.invites import InviteSigner
from backend.app.seed import seed_database
from backend.app.serializers import utc_now
from backend.server import create_app

from .test_product_flows import csrf, signup


def configure_livekit(mongo_db) -> None:
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "livekit",
            "publicValue": {
                "enabled": "true",
                "url": "wss://example.livekit.cloud",
            },
            "encryptedValue": {},
            "secretFingerprint": {},
        }
    )


def test_room_resolution_accepts_naive_mongo_datetime(mongo_db, master_key):
    seed_database(mongo_db)
    app = create_app(database=mongo_db, master_key=master_key)
    expires_at = (utc_now() + timedelta(hours=1)).replace(tzinfo=None)
    room = {
        "id": "room-naive-date",
        "hostId": "host-id",
        "slug": "naive-date",
        "title": "Timezone-safe call",
        "status": "OPEN",
        "inviteVersion": 1,
        "waitingRoom": True,
        "allowGuests": True,
        "maxParticipants": 2,
        "expiresAt": expires_at,
    }
    mongo_db.call_rooms.insert_one(room)
    token = InviteSigner(app.state.settings.auth_secret).sign(
        room["id"], room["inviteVersion"], int(expires_at.timestamp())
    )

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get(f"/api/rooms/{room['slug']}?invite={token}")

    assert response.status_code == 200
    assert response.json()["title"] == "Timezone-safe call"


def test_expired_call_returns_specific_error(mongo_db, master_key):
    seed_database(mongo_db)
    app = create_app(database=mongo_db, master_key=master_key)
    expires_at = (utc_now() - timedelta(minutes=1)).replace(tzinfo=None)
    room = {
        "id": "expired-room",
        "hostId": "host-id",
        "slug": "expired-link",
        "title": "Expired call",
        "status": "OPEN",
        "inviteVersion": 1,
        "waitingRoom": True,
        "allowGuests": True,
        "maxParticipants": 2,
        "expiresAt": expires_at,
    }
    mongo_db.call_rooms.insert_one(room)
    token = InviteSigner(app.state.settings.auth_secret).sign(
        room["id"],
        room["inviteVersion"],
        int((utc_now() + timedelta(minutes=1)).timestamp()),
    )

    response = TestClient(app, raise_server_exceptions=False).get(
        f"/api/rooms/{room['slug']}?invite={token}"
    )

    assert response.status_code == 410
    assert response.json()["code"] == "CALL_EXPIRED"
    assert response.json()["message"] == "This call link has expired"


def test_token_endpoint_reports_livekit_not_configured(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    now = utc_now()
    room = {
        "id": "token-room",
        "hostId": user["id"],
        "slug": "token-room",
        "title": "Token room",
        "status": "OPEN",
        "inviteVersion": 1,
        "waitingRoom": True,
        "allowGuests": True,
        "maxParticipants": 2,
        "expiresAt": now + timedelta(hours=1),
        "createdAt": now,
        "updatedAt": now,
    }
    mongo_db.call_rooms.insert_one(room)
    mongo_db.call_participants.insert_one(
        {
            "id": "host-participant",
            "roomId": room["id"],
            "userId": user["id"],
            "role": "HOST",
            "state": "APPROVED",
            "createdAt": now,
            "updatedAt": now,
        }
    )

    response = client.post(
        f"/api/rooms/{room['id']}/token", headers=headers, json={}
    )

    assert response.status_code == 503
    assert response.json()["code"] == "LIVEKIT_NOT_CONFIGURED"
    assert "LiveKit URL, API key, and API secret" in response.json()["message"]
    assert mongo_db.call_rooms.find_one({"id": room["id"]})["status"] == "OPEN"
    assert (
        mongo_db.call_participants.find_one({"id": "host-participant"})["state"]
        == "APPROVED"
    )


def test_readiness_reports_exact_missing_call_configuration(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)

    response = client.get("/api/system/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["callCreationReady"] is False
    assert payload["checks"]["database"]["status"] == "READY"
    assert payload["checks"]["storage"]["status"] == "READY"
    assert payload["checks"]["ai"]["status"] == "READY"
    assert payload["checks"]["browserAi"]["status"] == "READY"
    assert payload["checks"]["emergentAi"]["status"] == "MISSING"
    assert payload["checks"]["cloudAi"]["status"] == "MISSING"
    assert payload["checks"]["livekit"]["status"] == "MISSING"
    assert payload["checks"]["email"]["status"] == "MISSING"
    assert payload["blockingReasons"] == [
        "LiveKit URL, API key, and API secret are required for video calls."
    ]


def test_call_creation_is_blocked_until_livekit_is_configured(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)

    response = client.post(
        "/api/rooms",
        headers=headers,
        json={
            "title": "Blocked room",
            "waitingRoom": True,
            "allowGuests": True,
            "maxParticipants": 2,
            "expiresInMinutes": 60,
        },
    )

    assert response.status_code == 503
    assert response.json()["code"] == "LIVEKIT_NOT_CONFIGURED"


def test_cloud_only_face_activation_reports_emergent_ai_missing(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    now = utc_now()
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "ai",
            "publicValue": {
                "enabled": "true",
                "provider": "emergent",
                "mode": "cloud",
            },
            "encryptedValue": {},
            "secretFingerprint": {},
        }
    )
    mongo_db.face_profiles.insert_one(
        {
            "id": "approved-face",
            "userId": user["id"],
            "objectKey": "faces/approved.jpg",
            "active": True,
            "moderationStatus": "APPROVED",
            "consentRevokedAt": None,
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
    )

    response = client.post(
        "/api/faces/approved-face/activate",
        headers=headers,
        json={},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "EMERGENT_AI_CREDITS_UNAVAILABLE"
