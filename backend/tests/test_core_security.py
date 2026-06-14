from fastapi.testclient import TestClient
import pytest

from backend.app.config import Settings
from backend.app.seed import DEFAULT_PLANS, seed_database
from backend.app.serializers import utc_now
from backend.app.vault import SecretVault
from backend.server import create_app


def test_seed_is_idempotent_and_creates_default_plans(mongo_db, master_key):
    seed_database(
        mongo_db,
        admin_email="admin@example.com",
        admin_password="StrongAdmin2026!",
    )
    seed_database(
        mongo_db,
        admin_email="admin@example.com",
        admin_password="StrongAdmin2026!",
    )

    assert mongo_db.plans.count_documents({}) == len(DEFAULT_PLANS)
    assert mongo_db.users.count_documents({"email": "admin@example.com"}) == 1
    assert mongo_db.admin_users.count_documents({}) == 1


def test_vault_encrypts_and_masks_secrets(master_key):
    vault = SecretVault(master_key)

    encrypted = vault.encrypt("sk_live_sensitive")

    assert "sk_live_sensitive" not in encrypted
    assert vault.decrypt(encrypted) == "sk_live_sensitive"
    assert vault.fingerprint("sk_live_sensitive").startswith("sha256:")


def test_signup_login_and_session_cookie(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    csrf = client.get("/api/auth/csrf").json()["csrfToken"]

    signup = client.post(
        "/api/auth/signup",
        headers={"x-csrf-token": csrf},
        json={
            "email": "person@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Test Person",
        },
    )

    assert signup.status_code == 201
    assert signup.json()["user"]["email"] == "person@example.com"
    assert client.cookies.get("tf_access")
    session = client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.json()["email"] == "person@example.com"


def test_state_change_rejects_missing_csrf(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))

    response = client.post(
        "/api/auth/signup",
        json={
            "email": "person@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Test Person",
        },
    )

    assert response.status_code == 403
    assert response.json()["message"] == "Invalid CSRF token"


def test_private_upload_rejects_spoofed_content_type(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    csrf = client.get("/api/auth/csrf").json()["csrfToken"]
    client.post(
        "/api/auth/signup",
        headers={"x-csrf-token": csrf},
        json={
            "email": "person@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Test Person",
        },
    )
    signed = client.post(
        "/api/faces/upload-url",
        headers={"x-csrf-token": csrf},
        json={"contentType": "image/jpeg", "sizeBytes": 30},
    ).json()

    response = client.put(
        signed["url"],
        content=b"<html><script>alert(1)</script>",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 422
    assert response.json()["message"] == "Uploaded file content is invalid"


def test_signed_upload_is_single_use(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    csrf = client.get("/api/auth/csrf").json()["csrfToken"]
    client.post(
        "/api/auth/signup",
        headers={"x-csrf-token": csrf},
        json={
            "email": "person@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Test Person",
        },
    )
    signed = client.post(
        "/api/faces/upload-url",
        headers={"x-csrf-token": csrf},
        json={"contentType": "image/jpeg", "sizeBytes": 67},
    ).json()
    payload = b"\xff\xd8\xff" + b"\x00" * 64

    first = client.put(
        signed["url"],
        content=payload,
        headers={"content-type": "image/jpeg"},
    )
    replay = client.put(
        signed["url"],
        content=payload,
        headers={"content-type": "image/jpeg"},
    )

    assert first.status_code == 200
    assert replay.status_code == 409
    assert replay.json()["message"] == "Upload has already been completed"


def test_production_refuses_default_security_keys(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://trueface.example")
    monkeypatch.delenv("AUTH_SECRET", raising=False)
    monkeypatch.delenv("SETTINGS_MASTER_KEY", raising=False)

    with pytest.raises(RuntimeError, match="AUTH_SECRET"):
        Settings.from_env()


def test_untrusted_host_header_is_rejected(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))

    response = client.get(
        "/api/health",
        headers={"host": "attacker.example"},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_HOST"


def test_suspended_user_cannot_refresh_or_admin_login(mongo_db, master_key):
    seed_database(
        mongo_db,
        admin_email="admin@example.com",
        admin_password="StrongAdmin2026!",
    )
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    csrf = client.get("/api/auth/csrf").json()["csrfToken"]
    login = client.post(
        "/api/auth/admin-login",
        headers={"x-csrf-token": csrf},
        json={
            "email": "admin@example.com",
            "password": "StrongAdmin2026!",
        },
    )
    assert login.status_code == 200
    mongo_db.users.update_one(
        {"email": "admin@example.com"},
        {"$set": {"status": "SUSPENDED"}},
    )

    refreshed = client.post(
        "/api/auth/refresh",
        headers={"x-csrf-token": csrf},
        json={},
    )
    relogin = client.post(
        "/api/auth/admin-login",
        headers={"x-csrf-token": csrf},
        json={
            "email": "admin@example.com",
            "password": "StrongAdmin2026!",
        },
    )

    assert refreshed.status_code == 200
    assert refreshed.json()["refreshed"] is False
    assert relogin.status_code == 403


def test_broadcast_notification_read_state_is_per_user(mongo_db, master_key):
    first = TestClient(create_app(database=mongo_db, master_key=master_key))
    first_headers = first.get("/api/auth/csrf").json()["csrfToken"]
    first.post(
        "/api/auth/signup",
        headers={"x-csrf-token": first_headers},
        json={
            "email": "first@example.com",
            "password": "StrongPassword2026!",
            "displayName": "First User",
        },
    )
    second = TestClient(create_app(database=mongo_db, master_key=master_key))
    second_headers = second.get("/api/auth/csrf").json()["csrfToken"]
    second.post(
        "/api/auth/signup",
        headers={"x-csrf-token": second_headers},
        json={
            "email": "second@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Second User",
        },
    )
    mongo_db.notifications.insert_one(
        {
            "id": "broadcast-1",
            "userId": None,
            "audience": "ALL",
            "title": "Maintenance",
            "body": "Scheduled update",
            "readAt": None,
            "createdAt": utc_now(),
        }
    )

    read = first.patch(
        "/api/notifications/broadcast-1/read",
        headers={"x-csrf-token": first_headers},
        json={},
    )
    first_items = first.get("/api/notifications").json()
    second_items = second.get("/api/notifications").json()

    assert read.status_code == 200
    assert first_items[0]["readAt"] is not None
    assert second_items[0]["readAt"] is None
