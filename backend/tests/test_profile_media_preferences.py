from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.server import create_app

from .test_product_flows import csrf, signup


def test_profile_preferences_save_and_reload(mongo_db, master_key):
    seed_database(mongo_db)
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)

    saved = client.patch(
        "/api/auth/profile",
        headers=headers,
        json={
            "displayName": "Ada Stream",
            "gender": "FEMALE",
            "voicePreference": "FEMALE_TONE",
        },
    )
    session = client.get("/api/auth/session")

    assert saved.status_code == 200
    assert session.status_code == 200
    assert session.json()["displayName"] == "Ada Stream"
    assert session.json()["gender"] == "FEMALE"
    assert session.json()["voicePreference"] == "FEMALE_TONE"
    assert session.json()["faceProfileStatus"] == "NONE"


def test_profile_preferences_reject_unknown_values(mongo_db, master_key):
    seed_database(mongo_db)
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)

    response = client.patch(
        "/api/auth/profile",
        headers=headers,
        json={"gender": "ROBOT", "voicePreference": "CELEBRITY"},
    )

    assert response.status_code == 422


def test_admin_can_disable_face_and_voice_features(mongo_db, master_key):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    user_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(user_client)
    target = mongo_db.users.find_one({"email": "user@example.com"})

    admin_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    admin_headers = csrf(admin_client)
    admin_client.post(
        "/api/auth/admin-login",
        headers=admin_headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    response = admin_client.patch(
        f"/api/admin/users/{target['id']}/feature-access",
        headers=admin_headers,
        json={"faceDisabled": True, "voiceDisabled": True},
    )

    assert response.status_code == 200
    stored = mongo_db.users.find_one({"id": target["id"]})
    assert stored["faceFeaturesDisabled"] is True
    assert stored["voiceFeaturesDisabled"] is True
    assert mongo_db.audit_logs.find_one(
        {"action": "USER_MEDIA_FEATURES_UPDATED", "targetId": target["id"]}
    )


def test_plan_subscription_duration_is_separate_from_credit_reset(
    mongo_db, master_key
):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = csrf(client)
    client.post(
        "/api/auth/admin-login",
        headers=headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    basic = mongo_db.plans.find_one({"key": "basic"})

    response = client.put(
        f"/api/admin/plans/{basic['id']}",
        headers=headers,
        json={"subscriptionDurationDays": 45, "creditResetDays": 30},
    )

    assert response.status_code == 200
    assert response.json()["subscriptionDurationDays"] == 45
    assert response.json()["creditResetDays"] == 30
