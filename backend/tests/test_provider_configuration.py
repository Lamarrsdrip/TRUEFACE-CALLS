from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.server import create_app

from .test_product_flows import csrf


def logged_in_admin(mongo_db, master_key) -> tuple[TestClient, dict[str, str]]:
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = csrf(client)
    client.post(
        "/api/auth/admin-login",
        headers=headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    return client, headers


def test_provider_list_excludes_stripe_and_reports_gridfs_configured(
    mongo_db, master_key
):
    client, _headers = logged_in_admin(mongo_db, master_key)

    providers = client.get("/api/admin/providers").json()
    by_key = {provider["provider"]: provider for provider in providers}

    assert "stripe" not in by_key
    assert by_key["storage"]["configurationStatus"] == "CONFIGURED"
    assert by_key["storage"]["values"]["provider"] == "gridfs"
    assert by_key["ai"]["configurationStatus"] == "CONFIGURED"
    assert by_key["ai"]["values"]["provider"] == "emergent"
    assert by_key["ai"]["values"]["mode"] == "browser"


def test_gmail_email_configuration_moves_from_partial_to_configured(
    mongo_db, master_key
):
    client, headers = logged_in_admin(mongo_db, master_key)

    partial = client.put(
        "/api/admin/providers/email",
        headers=headers,
        json={
            "values": {
                "provider": "gmail",
                "senderEmail": "calls@example.com",
                "senderName": "TrueFace Calls",
            }
        },
    )
    partial_list = client.get("/api/admin/providers").json()
    complete = client.put(
        "/api/admin/providers/email",
        headers=headers,
        json={"values": {"appPassword": "gmail-app-password"}},
    )
    complete_list = client.get("/api/admin/providers").json()

    assert partial.status_code == 200
    assert next(
        item for item in partial_list if item["provider"] == "email"
    )["configurationStatus"] == "PARTIALLY_CONFIGURED"
    assert complete.status_code == 200
    email = next(item for item in complete_list if item["provider"] == "email")
    assert email["configurationStatus"] == "CONFIGURED"
    assert email["values"]["host"] == "smtp.gmail.com"
    assert email["values"]["port"] == "465"
    assert email["values"]["secure"] == "ssl"
    assert email["secrets"]["appPassword"].startswith("sha256:")


def test_gmail_test_email_uses_app_password(
    mongo_db, master_key, monkeypatch
):
    client, headers = logged_in_admin(mongo_db, master_key)
    calls: dict = {}

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            calls["connection"] = (host, port, timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def login(self, username, password):
            calls["login"] = (username, password)

        def send_message(self, message):
            calls["recipient"] = message["To"]

    monkeypatch.setattr(
        "backend.app.email_service.smtplib.SMTP_SSL", FakeSmtp
    )
    client.put(
        "/api/admin/providers/email",
        headers=headers,
        json={
            "values": {
                "provider": "gmail",
                "senderEmail": "calls@example.com",
                "senderName": "TrueFace Calls",
                "appPassword": "gmail-app-password",
            }
        },
    )

    response = client.post(
        "/api/admin/providers/email/test-email",
        headers=headers,
        json={"recipient": "owner@example.com"},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Test email sent to owner@example.com."
    assert calls["connection"] == ("smtp.gmail.com", 465, 10)
    assert calls["login"] == ("calls@example.com", "gmail-app-password")
    assert calls["recipient"] == "owner@example.com"


def test_environment_credentials_are_fallback_and_admin_values_override(
    mongo_db, master_key, monkeypatch
):
    monkeypatch.setenv("LIVEKIT_URL", "wss://fallback.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "fallback-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "fallback-secret")
    client, headers = logged_in_admin(mongo_db, master_key)

    initial = client.get("/api/admin/providers").json()
    livekit = next(item for item in initial if item["provider"] == "livekit")
    assert livekit["configurationStatus"] == "CONFIGURED"
    assert livekit["values"]["url"] == "wss://fallback.livekit.cloud"
    assert livekit["secrets"]["apiSecret"].startswith("sha256:")

    saved = client.put(
        "/api/admin/providers/livekit",
        headers=headers,
        json={"values": {"url": "wss://admin.livekit.cloud"}},
    )
    updated = client.get("/api/admin/providers").json()
    livekit = next(item for item in updated if item["provider"] == "livekit")

    assert saved.status_code == 200
    assert livekit["values"]["url"] == "wss://admin.livekit.cloud"


def test_provider_update_rejects_unknown_fields(mongo_db, master_key):
    client, headers = logged_in_admin(mongo_db, master_key)

    response = client.put(
        "/api/admin/providers/livekit",
        headers=headers,
        json={"values": {"apiSecretTypo": "must-not-be-public"}},
    )

    assert response.status_code == 422
    assert "Unknown provider fields" in response.json()["message"]


def test_browser_ai_connection_test_needs_no_cloud_key(mongo_db, master_key):
    client, headers = logged_in_admin(mongo_db, master_key)
    saved = client.put(
        "/api/admin/providers/ai",
        headers=headers,
        json={
            "values": {
                "enabled": "true",
                "provider": "emergent",
                "mode": "browser",
            }
        },
    )
    tested = client.post(
        "/api/admin/providers/ai/test",
        headers=headers,
        json={},
    )

    assert saved.status_code == 200
    assert tested.status_code == 200
    assert tested.json()["status"] == "OPERATIONAL"
    assert "needs no cloud key" in tested.json()["message"]


def test_emergent_llm_environment_is_used_without_exposing_api_key(
    mongo_db, master_key, monkeypatch
):
    monkeypatch.setenv("EMERGENT_LLM_BASE_URL", "https://llm.emergent.example")
    monkeypatch.setenv("EMERGENT_LLM_API_KEY", "emergent-secret")
    monkeypatch.setenv("AI_FACE_PROVIDER", "cloud")
    monkeypatch.setenv("GPU_PROVIDER", "runpod")
    monkeypatch.setenv("GPU_INFERENCE_URL", "https://gpu.example/process")
    monkeypatch.setenv("GPU_INFERENCE_API_KEY", "gpu-secret")
    client, _headers = logged_in_admin(mongo_db, master_key)

    providers = client.get("/api/admin/providers").json()
    ai = next(item for item in providers if item["provider"] == "ai")
    gpu = next(item for item in providers if item["provider"] == "gpu")

    assert ai["configurationStatus"] == "CONFIGURED"
    assert ai["values"]["gatewayUrl"] == "https://llm.emergent.example"
    assert ai["values"]["mode"] == "cloud"
    assert "universalKey" not in ai["values"]
    assert ai["secrets"]["universalKey"].startswith("sha256:")
    assert gpu["configurationStatus"] == "CONFIGURED"
    assert gpu["values"]["provider"] == "runpod"
    assert gpu["values"]["endpoint"] == "https://gpu.example/process"
    assert gpu["secrets"]["apiKey"].startswith("sha256:")


def test_emergent_ai_test_records_credit_and_realtime_capabilities(
    mongo_db, master_key, monkeypatch
):
    client, headers = logged_in_admin(mongo_db, master_key)
    client.put(
        "/api/admin/providers/ai",
        headers=headers,
        json={
            "values": {
                "enabled": "true",
                "provider": "emergent",
                "mode": "hybrid",
                "gatewayUrl": "https://ai.emergent.example",
                "universalKey": "emergent-secret",
            }
        },
    )

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "remainingCredits": 420,
                "capabilities": {"realtimeFaceVideo": False},
            }

    monkeypatch.setattr(
        "backend.app.routers.providers.httpx.get",
        lambda *_args, **_kwargs: Response(),
    )

    response = client.post(
        "/api/admin/providers/ai/test",
        headers=headers,
        json={},
    )
    readiness = client.get("/api/system/readiness").json()

    assert response.status_code == 200
    assert response.json()["status"] == "OPERATIONAL"
    assert response.json()["remainingCredits"] == 420
    assert readiness["checks"]["emergentAi"]["status"] == "READY"
    assert readiness["checks"]["emergentAi"]["remainingCredits"] == 420
    assert readiness["checks"]["cloudAi"]["status"] == "MISSING"
