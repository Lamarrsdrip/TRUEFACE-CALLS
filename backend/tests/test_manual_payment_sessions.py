from datetime import timedelta

from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.app.serializers import utc_now
from backend.server import create_app

from .test_product_flows import csrf, signup


def configure_manual_bank(mongo_db, expiry_minutes: int = 30) -> None:
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "manual-bank",
            "publicValue": {
                "enabled": "true",
                "bankName": "Test Bank",
                "accountName": "TrueFace Calls",
                "accountNumber": "0123456789",
                "instructions": "Use your payment code if your bank supports narration.",
                "expiryMinutes": str(expiry_minutes),
                "minimumMinor": "10000",
                "maximumMinor": "100000000",
            },
            "encryptedValue": {},
            "secretFingerprint": {},
        }
    )


def test_manual_session_has_exact_naira_amount_reference_and_expiry(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    configure_manual_bank(mongo_db)
    basic = mongo_db.plans.find_one({"key": "basic"})

    response = client.post(
        "/api/billing/checkout/manual-session",
        headers=headers,
        json={"type": "subscription", "planId": basic["id"]},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "PENDING"
    assert payload["currency"] == "NGN"
    assert payload["amountMinor"] == basic["priceMonthlyMinor"]
    assert payload["paymentReference"].startswith("TFC-")
    assert payload["expiresAt"]
    assert payload["bank"]["accountNumber"] == "0123456789"


def test_manual_transfer_reference_is_optional_and_payment_can_expire(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    configure_manual_bank(mongo_db)
    basic = mongo_db.plans.find_one({"key": "basic"})
    payment = client.post(
        "/api/billing/checkout/manual-session",
        headers=headers,
        json={"type": "subscription", "planId": basic["id"]},
    ).json()

    submitted = client.post(
        f"/api/billing/checkout/manual-session/{payment['id']}/submit",
        headers=headers,
        json={},
    )
    mongo_db.payments.update_one(
        {"id": payment["id"]},
        {"$set": {"expiresAt": utc_now() - timedelta(seconds=1)}},
    )
    expired = client.get(f"/api/billing/payments/{payment['id']}")

    assert submitted.status_code == 200
    assert submitted.json()["status"] == "PENDING"
    assert expired.status_code == 200
    assert expired.json()["status"] == "EXPIRED"


def test_admin_can_approve_expired_manual_payment_once(mongo_db, master_key):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    configure_manual_bank(mongo_db)
    user_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    user_headers = signup(user_client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    basic = mongo_db.plans.find_one({"key": "basic"})
    payment = user_client.post(
        "/api/billing/checkout/manual-session",
        headers=user_headers,
        json={"type": "subscription", "planId": basic["id"]},
    ).json()
    mongo_db.payments.update_one(
        {"id": payment["id"]},
        {
            "$set": {
                "status": "EXPIRED",
                "expiresAt": utc_now() - timedelta(minutes=1),
            }
        },
    )

    admin_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    admin_headers = csrf(admin_client)
    admin_client.post(
        "/api/auth/admin-login",
        headers=admin_headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    first = admin_client.post(
        f"/api/admin/payments/{payment['id']}/decision",
        headers=admin_headers,
        json={"decision": "APPROVE", "reason": "Transfer reconciled after timeout"},
    )
    second = admin_client.post(
        f"/api/admin/payments/{payment['id']}/decision",
        headers=admin_headers,
        json={"decision": "APPROVE", "reason": "Duplicate approval"},
    )

    assert first.status_code == 200
    assert first.json()["status"] == "APPROVED"
    assert second.json()["idempotent"] is True
    assert mongo_db.subscriptions.count_documents(
        {"userId": user["id"], "planId": basic["id"], "status": "ACTIVE"}
    ) == 1
    log = mongo_db.audit_logs.find_one(
        {"action": "MANUAL_PAYMENT_APPROVED", "targetId": payment["id"]}
    )
    assert log["afterRedacted"]["amountMinor"] == basic["priceMonthlyMinor"]
    assert log["afterRedacted"]["paymentReference"].startswith("TFC-")
