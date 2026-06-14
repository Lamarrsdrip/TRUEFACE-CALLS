import hashlib
import hmac
import json
import uuid

from fastapi.testclient import TestClient

from backend.app.payment_fulfillment import fulfill_payment
from backend.app.serializers import utc_now
from backend.app.vault import SecretVault
from backend.server import create_app

from .test_product_flows import signup


def configure_provider(mongo_db, master_key, provider: str, values: dict) -> None:
    vault = SecretVault(master_key)
    public = {"enabled": "true", "mode": "test"}
    encrypted = {key: vault.encrypt(value) for key, value in values.items()}
    mongo_db.app_settings.insert_one(
        {
            "namespace": "provider",
            "key": provider,
            "publicValue": public,
            "encryptedValue": encrypted,
            "secretFingerprint": {
                key: vault.fingerprint(value) for key, value in values.items()
            },
        }
    )


def pending_subscription_payment(mongo_db, provider: str) -> dict:
    user = mongo_db.users.find_one({"email": "user@example.com"})
    plan = mongo_db.plans.find_one({"key": "basic"})
    now = utc_now()
    payment = {
        "id": str(uuid.uuid4()),
        "userId": user["id"],
        "provider": provider.upper(),
        "type": "SUBSCRIPTION",
        "status": "PENDING",
        "amountMinor": plan["priceMonthlyMinor"],
        "currency": "NGN",
        "creditsMilli": None,
        "idempotencyKey": str(uuid.uuid4()),
        "metadata": {"planId": plan["id"]},
        "createdAt": now,
        "updatedAt": now,
    }
    mongo_db.payments.insert_one(payment)
    return payment


def test_paystack_webhook_activates_subscription_once(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    configure_provider(mongo_db, master_key, "paystack", {"secretKey": "paystack-secret"})
    payment = pending_subscription_payment(mongo_db, "paystack")
    payload = {
        "event": "charge.success",
        "data": {
            "id": 818181,
            "reference": payment["id"],
            "status": "success",
            "amount": payment["amountMinor"],
            "currency": "NGN",
        },
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(b"paystack-secret", raw, hashlib.sha512).hexdigest()

    first = client.post(
        "/api/webhooks/paystack",
        content=raw,
        headers={
            "content-type": "application/json",
            "x-paystack-signature": signature,
        },
    )
    second = client.post(
        "/api/webhooks/paystack",
        content=raw,
        headers={
            "content-type": "application/json",
            "x-paystack-signature": signature,
        },
    )

    assert first.status_code == 200
    assert first.json()["settled"] is True
    assert second.json()["duplicate"] is True
    assert mongo_db.payments.find_one({"id": payment["id"]})["status"] == "SUCCEEDED"
    active = list(
        mongo_db.subscriptions.find(
            {"userId": payment["userId"], "status": "ACTIVE"}
        )
    )
    assert len(active) == 1
    assert mongo_db.credit_transactions.count_documents(
        {"paymentId": payment["id"]}
    ) == 1


def test_flutterwave_webhook_rejects_amount_mismatch(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    configure_provider(
        mongo_db,
        master_key,
        "flutterwave",
        {"secretKey": "flw-secret", "webhookHash": "flw-hash"},
    )
    payment = pending_subscription_payment(mongo_db, "flutterwave")
    payload = {
        "event": "charge.completed",
        "data": {
            "id": 919191,
            "tx_ref": payment["id"],
            "status": "successful",
            "amount": 1,
            "currency": "NGN",
        },
    }

    response = client.post(
        "/api/webhooks/flutterwave",
        json=payload,
        headers={"verif-hash": "flw-hash"},
    )

    assert response.status_code == 409
    stored = mongo_db.payments.find_one({"id": payment["id"]})
    assert stored["status"] == "REVIEW_REQUIRED"
    assert mongo_db.credit_transactions.count_documents(
        {"paymentId": payment["id"]}
    ) == 0


def test_unconfigured_gateway_webhook_fails_closed(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))

    response = client.post(
        "/api/webhooks/flutterwave",
        json={"event": "charge.completed", "data": {}},
    )

    assert response.status_code == 503
    assert response.json()["code"] == "PAYMENT_PROVIDER_NOT_CONFIGURED"


def test_non_terminal_gateway_event_does_not_fail_pending_payment(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    configure_provider(
        mongo_db,
        master_key,
        "flutterwave",
        {"secretKey": "flw-secret", "webhookHash": "flw-hash"},
    )
    payment = pending_subscription_payment(mongo_db, "flutterwave")

    response = client.post(
        "/api/webhooks/flutterwave",
        json={
            "event": "transfer.pending",
            "data": {
                "tx_ref": payment["id"],
                "status": "pending",
                "amount": payment["amountMinor"] / 100,
                "currency": "NGN",
            },
        },
        headers={"verif-hash": "flw-hash"},
    )

    assert response.status_code == 200
    assert response.json()["settled"] is False
    assert mongo_db.payments.find_one({"id": payment["id"]})["status"] == "PENDING"


def test_wallet_payment_marker_prevents_double_grant_after_partial_retry(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    payment = pending_subscription_payment(mongo_db, "paystack")

    fulfill_payment(mongo_db, payment)
    wallet_after_first = mongo_db.credit_wallets.find_one(
        {"userId": payment["userId"]}
    )
    mongo_db.credit_transactions.delete_one(
        {"idempotencyKey": f"payment-fulfillment:{payment['id']}"}
    )

    fulfill_payment(mongo_db, payment)
    wallet_after_retry = mongo_db.credit_wallets.find_one(
        {"userId": payment["userId"]}
    )

    assert (
        wallet_after_retry["availableMilliCredits"]
        == wallet_after_first["availableMilliCredits"]
    )
    assert mongo_db.subscriptions.count_documents(
        {
            "userId": payment["userId"],
            "id": f"payment:{payment['id']}",
            "status": "ACTIVE",
        }
    ) == 1
    assert mongo_db.credit_transactions.count_documents(
        {"idempotencyKey": f"payment-fulfillment:{payment['id']}"}
    ) == 1
