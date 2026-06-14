from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.app.vault import SecretVault
from backend.server import create_app


def csrf(client: TestClient) -> dict[str, str]:
    token = client.get("/api/auth/csrf").json()["csrfToken"]
    return {"x-csrf-token": token}


def signup(client: TestClient, email: str = "user@example.com") -> dict[str, str]:
    headers = csrf(client)
    response = client.post(
        "/api/auth/signup",
        headers=headers,
        json={
            "email": email,
            "password": "StrongPassword2026!",
            "displayName": "Product User",
        },
    )
    assert response.status_code == 201
    return headers


def configure_manual_bank(mongo_db) -> None:
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "manual-bank",
            "publicValue": {
                "enabled": "true",
                "bankName": "Test Bank",
                "accountName": "TrueFace Calls",
                "accountNumber": "0123456789",
                "expiryMinutes": "30",
                "proofRequired": "false",
            },
            "encryptedValue": {},
            "secretFingerprint": {},
        }
    )


def upload_face_image(client: TestClient, headers: dict[str, str]) -> dict:
    payload = b"\xff\xd8\xff" + b"\x00" * 64
    signed = client.post(
        "/api/faces/upload-url",
        headers=headers,
        json={"contentType": "image/jpeg", "sizeBytes": len(payload)},
    )
    assert signed.status_code == 200
    upload = client.put(
        signed.json()["url"],
        content=payload,
        headers={"content-type": "image/jpeg"},
    )
    assert upload.status_code == 200
    return {
        "objectKey": signed.json()["objectKey"],
        "mimeType": "image/jpeg",
        "sizeBytes": len(payload),
    }


def test_provider_secrets_are_encrypted_and_masked(mongo_db, master_key):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = csrf(client)
    login = client.post(
        "/api/auth/admin-login",
        headers=headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    assert login.status_code == 200

    saved = client.put(
        "/api/admin/providers/livekit",
        headers=headers,
        json={
            "values": {
                "enabled": "true",
                "url": "wss://example.livekit.cloud",
                "apiKey": "api-key",
                "apiSecret": "very-secret-value",
            }
        },
    )
    listed = client.get("/api/admin/providers").json()
    stored = mongo_db.app_settings.find_one(
        {"namespace": "provider", "key": "livekit"}
    )

    assert saved.status_code == 200
    assert "very-secret-value" not in str(stored)
    assert listed[0]["secrets"]["apiSecret"].startswith("sha256:")


def test_trial_user_cannot_buy_topup_but_manual_subscription_stays_pending(
    mongo_db, master_key
):
    configure_manual_bank(mongo_db)
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    wallet = client.get("/api/credits/wallet").json()
    paid_plan = mongo_db.plans.find_one({"key": "basic"})

    packs = client.get("/api/billing/credit-packs")
    payment = client.post(
        "/api/billing/checkout/manual",
        headers=headers,
        json={
            "type": "subscription",
            "planId": paid_plan["id"],
            "transferReference": "BANK-2026-001",
        },
    )

    assert wallet["topUpAllowed"] is False
    assert packs.status_code == 403
    assert payment.status_code == 200
    assert payment.json()["status"] == "PENDING"
    assert mongo_db.subscriptions.count_documents({"status": "ACTIVE"}) == 0


def test_room_persists_with_distinct_host_and_guest_urls(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    vault = SecretVault(master_key)
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "livekit",
            "publicValue": {
                "enabled": "true",
                "url": "wss://example.livekit.cloud",
            },
            "encryptedValue": {
                "apiKey": vault.encrypt("test-key"),
                "apiSecret": vault.encrypt("test-secret"),
            },
            "secretFingerprint": {
                "apiKey": vault.fingerprint("test-key"),
                "apiSecret": vault.fingerprint("test-secret"),
            },
        }
    )

    created = client.post(
        "/api/rooms",
        headers=headers,
        json={
            "title": "Persistent room",
            "waitingRoom": True,
            "allowGuests": True,
            "maxParticipants": 2,
            "expiresInMinutes": 1440,
        },
    )
    rooms = client.get("/api/calls/rooms").json()

    assert created.status_code == 200
    assert created.json()["hostUrl"].endswith("&host=1")
    assert "host=1" not in created.json()["inviteUrl"]
    assert rooms[0]["title"] == "Persistent room"
    assert rooms[0]["inviteUrl"] == created.json()["inviteUrl"]


def test_face_profile_requires_all_consent_and_reports_readiness(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    uploaded = upload_face_image(client, headers)
    quality = client.post(
        "/api/faces/quality-check",
        headers=headers,
        json={
            "width": 1200,
            "height": 1200,
            "faceCount": 1,
            "sharpness": 0.9,
            "brightness": 0.7,
            "faceCoverage": 0.5,
        },
    )
    created = client.post(
        "/api/faces",
        headers=headers,
        json={
            "name": "Authorized profile",
            "images": [
                {
                    **uploaded,
                    "role": "FRONT",
                    "width": 1200,
                    "height": 1200,
                    "quality": quality.json(),
                }
            ],
            "consent": {
                "ownsOrHasPermission": True,
                "consentsToFaceUse": True,
                "acceptsFaceTerms": True,
                "termsVersion": "2026-06-11",
            },
        },
    )

    assert quality.status_code == 200
    assert quality.json()["passed"] is True
    assert created.status_code == 200
    assert created.json()["readinessLabel"] in {"FAIR", "GOOD", "EXCELLENT"}
    assert mongo_db.consent_logs.count_documents({}) == 1


def test_face_profile_rejects_another_users_private_upload(
    mongo_db, master_key
):
    owner = TestClient(create_app(database=mongo_db, master_key=master_key))
    owner_headers = signup(owner, "owner@example.com")
    uploaded = upload_face_image(owner, owner_headers)

    attacker = TestClient(create_app(database=mongo_db, master_key=master_key))
    attacker_headers = signup(attacker, "attacker@example.com")
    response = attacker.post(
        "/api/faces",
        headers=attacker_headers,
        json={
            "name": "Stolen upload",
            "images": [
                {
                    **uploaded,
                    "role": "FRONT",
                    "width": 1200,
                    "height": 1200,
                    "quality": {
                        "score": 100,
                        "passed": True,
                        "checks": {},
                    },
                }
            ],
            "consent": {
                "ownsOrHasPermission": True,
                "consentsToFaceUse": True,
                "acceptsFaceTerms": True,
            },
        },
    )

    assert response.status_code == 403
    assert response.json()["message"] == "Face image is not owned by this user"
