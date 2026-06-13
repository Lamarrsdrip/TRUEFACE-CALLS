from fastapi.testclient import TestClient

from backend.app.seed import seed_database
from backend.server import create_app

from .test_product_flows import csrf, signup


def test_admin_approval_activates_manual_subscription_once(mongo_db, master_key):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    user_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    user_headers = signup(user_client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    basic = mongo_db.plans.find_one({"key": "basic"})
    payment = user_client.post(
        "/api/billing/checkout/manual",
        headers=user_headers,
        json={
            "type": "subscription",
            "planId": basic["id"],
            "transferReference": "BANK-APPROVE-001",
        },
    ).json()

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
        json={"decision": "APPROVE", "reason": "Reference reconciled"},
    )
    second = admin_client.post(
        f"/api/admin/payments/{payment['id']}/decision",
        headers=admin_headers,
        json={"decision": "APPROVE", "reason": "Duplicate click"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert mongo_db.subscriptions.count_documents(
        {"userId": user["id"], "planId": basic["id"], "status": "ACTIVE"}
    ) == 1
    assert mongo_db.credit_transactions.count_documents(
        {"idempotencyKey": f"manual-payment:{payment['id']}"}
    ) == 1


def test_safety_and_deployment_endpoints(mongo_db, master_key):
    seed_database(mongo_db, "admin@example.com", "StrongAdmin2026!")
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    headers = signup(client)
    reported = client.post(
        "/api/abuse-reports",
        headers=headers,
        json={"category": "harassment", "description": "Repeated unwanted calls"},
    )
    assert reported.status_code == 200

    admin_client = TestClient(create_app(database=mongo_db, master_key=master_key))
    admin_headers = csrf(admin_client)
    admin_client.post(
        "/api/auth/admin-login",
        headers=admin_headers,
        json={"email": "admin@example.com", "password": "StrongAdmin2026!"},
    )
    deployment = admin_client.get("/api/admin/deployment")

    assert deployment.status_code == 200
    assert deployment.json()["target"] == "Emergent native"
    assert deployment.json()["startCommand"].endswith("--port 8001")
