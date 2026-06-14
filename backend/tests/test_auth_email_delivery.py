from fastapi.testclient import TestClient

from backend.app.vault import SecretVault
from backend.server import create_app

from .test_product_flows import csrf


def configure_gmail(mongo_db, master_key):
    vault = SecretVault(master_key)
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "email",
            "publicValue": {
                "provider": "gmail",
                "senderEmail": "calls@example.com",
                "senderName": "TrueFace Calls",
                "host": "smtp.gmail.com",
                "port": "465",
                "secure": "ssl",
            },
            "encryptedValue": {
                "appPassword": vault.encrypt("gmail-app-password")
            },
            "secretFingerprint": {
                "appPassword": vault.fingerprint("gmail-app-password")
            },
        }
    )


def test_signup_and_password_reset_send_configured_email(
    mongo_db, master_key, monkeypatch
):
    configure_gmail(mongo_db, master_key)
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "backend.app.routers.auth.send_email",
        lambda _values, recipient, subject, text: sent.append(
            (recipient, subject, text)
        ),
    )
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = csrf(client)

    signup = client.post(
        "/api/auth/signup",
        headers=headers,
        json={
            "email": "person@example.com",
            "password": "StrongPassword2026!",
            "displayName": "Test Person",
        },
    )
    reset = client.post(
        "/api/auth/forgot-password",
        headers=headers,
        json={"email": "person@example.com"},
    )

    assert signup.status_code == 201
    assert signup.json()["verification"]["emailSent"] is True
    assert reset.status_code == 200
    assert len(sent) == 2
    assert "/verify-email?token=" in sent[0][2]
    assert "/reset-password?token=" in sent[1][2]
