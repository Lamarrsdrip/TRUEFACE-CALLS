from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.app.vault import SecretVault
from backend.server import create_app

from .test_product_flows import csrf
from .test_product_flows import configure_manual_bank, signup


def admin_client(mongo_db, master_key) -> tuple[TestClient, dict[str, str]]:
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = csrf(client)
    response = client.post(
        "/api/auth/admin-login",
        headers=headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    assert response.status_code == 200
    return client, headers


def test_seeded_plans_and_credit_packs_are_naira_only(mongo_db):
    seed_database(mongo_db)

    plans = list(mongo_db.plans.find({}, {"_id": 0}))
    packs = mongo_db.app_settings.find_one(
        {"namespace": "billing", "key": "credit-packs"}
    )["publicValue"]["packs"]

    assert {plan["currency"] for plan in plans} == {"NGN"}
    assert {pack["currency"] for pack in packs} == {"NGN"}
    assert mongo_db.plans.find_one({"key": "basic"})["priceMonthlyMinor"] >= 100_000


def test_admin_cannot_change_plan_currency_from_ngn(mongo_db, master_key):
    client, headers = admin_client(mongo_db, master_key)
    basic = mongo_db.plans.find_one({"key": "basic"})

    response = client.put(
        f"/api/admin/plans/{basic['id']}",
        headers=headers,
        json={"name": "Basic Nigeria", "currency": "USD"},
    )

    assert response.status_code == 200
    assert response.json()["currency"] == "NGN"
    assert mongo_db.plans.find_one({"id": basic["id"]})["currency"] == "NGN"


def test_seed_does_not_overwrite_admin_plan_pricing(mongo_db):
    seed_database(mongo_db)
    basic = mongo_db.plans.find_one({"key": "basic"})
    mongo_db.plans.update_one(
        {"id": basic["id"]}, {"$set": {"priceMonthlyMinor": 1_234_500}}
    )

    seed_database(mongo_db)

    assert (
        mongo_db.plans.find_one({"id": basic["id"]})["priceMonthlyMinor"]
        == 1_234_500
    )


def test_checkout_lists_only_enabled_payment_methods(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    configure_manual_bank(mongo_db)
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": "paystack",
            "publicValue": {"enabled": "false"},
            "encryptedValue": {
                "secretKey": SecretVault(master_key).encrypt("disabled-secret")
            },
            "secretFingerprint": {},
        }
    )

    response = client.get("/api/billing/payment-methods")

    assert response.status_code == 200
    assert response.json()["methods"] == [
        {"key": "bank", "label": "Bank transfer", "primary": True}
    ]
