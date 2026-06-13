from fastapi.testclient import TestClient

from backend.app.seed import DEFAULT_PLANS, seed_database
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
