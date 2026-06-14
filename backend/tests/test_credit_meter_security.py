from datetime import timedelta

from fastapi.testclient import TestClient

from backend.app.serializers import utc_now
from backend.server import create_app

from .test_product_flows import csrf, signup


def add_room_participant(mongo_db, user_id: str, room_id: str = "meter-room"):
    now = utc_now()
    mongo_db.call_rooms.insert_one(
        {
            "id": room_id,
            "hostId": user_id,
            "slug": room_id,
            "title": "Metered room",
            "status": "OPEN",
            "inviteVersion": 1,
            "waitingRoom": False,
            "allowGuests": True,
            "maxParticipants": 2,
            "expiresAt": now + timedelta(hours=1),
            "createdAt": now,
            "updatedAt": now,
        }
    )
    mongo_db.call_participants.insert_one(
        {
            "id": f"participant-{user_id}",
            "roomId": room_id,
            "userId": user_id,
            "role": "HOST",
            "state": "APPROVED",
            "createdAt": now,
            "updatedAt": now,
        }
    )


def test_meter_uses_server_rate_and_reservation_ownership(mongo_db, master_key):
    owner = TestClient(create_app(database=mongo_db, master_key=master_key))
    owner_headers = signup(owner)
    owner_user = mongo_db.users.find_one({"email": "user@example.com"})
    add_room_participant(mongo_db, owner_user["id"])
    mongo_db.credit_wallets.update_one(
        {"userId": owner_user["id"]},
        {
            "$set": {
                "availableMilliCredits": 50_000,
                "includedMilliCredits": 50_000,
            }
        },
    )
    wallet_before = mongo_db.credit_wallets.find_one({"userId": owner_user["id"]})

    quote = owner.get(
        "/api/credits/quote?roomId=meter-room&mode=AI_FACE&quality=LOW"
    ).json()
    reserved = owner.post(
        "/api/credits/meter/reserve",
        headers=owner_headers,
        json={
            "roomId": "meter-room",
            "mode": "AI_FACE",
            "quality": "LOW",
            "amountMilli": 1,
            "idempotencyKey": "reserve-owner-001",
        },
    )

    assert reserved.status_code == 200
    reservation = reserved.json()
    assert reservation["reservationMilli"] == quote["reservationMilli"]
    wallet_after = mongo_db.credit_wallets.find_one({"userId": owner_user["id"]})
    assert (
        wallet_before["availableMilliCredits"]
        - wallet_after["availableMilliCredits"]
        == quote["reservationMilli"]
    )

    settled = owner.post(
        "/api/credits/meter/settle",
        headers=owner_headers,
        json={
            "reservationId": reservation["id"],
            "meteringWindow": "window-owner-001",
            "billableMilliseconds": 15_000,
            "milliCreditsPerMinute": 1,
        },
    )

    assert settled.status_code == 200
    assert settled.json()["milliCreditsPerMinute"] == quote["milliCreditsPerMinute"]
    assert settled.json()["milliCreditsCharged"] > 1
    consumed_after_first = mongo_db.credit_wallets.find_one(
        {"userId": owner_user["id"]}
    )["lifetimeConsumedMilli"]
    duplicate_settlement = owner.post(
        "/api/credits/meter/settle",
        headers=owner_headers,
        json={
            "reservationId": reservation["id"],
            "meteringWindow": "window-owner-001",
            "billableMilliseconds": 15_000,
        },
    )
    duplicate_reservation = owner.post(
        "/api/credits/meter/reserve",
        headers=owner_headers,
        json={
            "roomId": "meter-room",
            "mode": "AI_FACE",
            "quality": "LOW",
            "idempotencyKey": "reserve-owner-001",
        },
    )

    assert duplicate_settlement.status_code == 200
    assert duplicate_settlement.json()["id"] == settled.json()["id"]
    assert duplicate_reservation.status_code == 200
    assert duplicate_reservation.json()["id"] == reservation["id"]
    assert (
        mongo_db.credit_wallets.find_one({"userId": owner_user["id"]})[
            "lifetimeConsumedMilli"
        ]
        == consumed_after_first
    )

    attacker = TestClient(create_app(database=mongo_db, master_key=master_key))
    attacker_headers = signup(attacker, "attacker@example.com")
    denied = attacker.post(
        "/api/credits/meter/release",
        headers=attacker_headers,
        json={
            "reservationId": reservation["id"],
            "idempotencyKey": "release-attacker-001",
        },
    )
    assert denied.status_code == 404


def test_meter_requires_approved_room_membership(mongo_db, master_key):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)

    response = client.get(
        "/api/credits/quote?roomId=missing&mode=AI_FACE&quality=LOW"
    )

    assert response.status_code == 404


def test_expired_subscription_cannot_spend_purchased_ai_credits(
    mongo_db, master_key
):
    client = TestClient(create_app(database=mongo_db, master_key=master_key))
    signup(client)
    user = mongo_db.users.find_one({"email": "user@example.com"})
    add_room_participant(mongo_db, user["id"])
    mongo_db.subscriptions.update_many(
        {"userId": user["id"]},
        {"$set": {"currentPeriodEnd": utc_now() - timedelta(seconds=1)}},
    )
    mongo_db.credit_wallets.update_one(
        {"userId": user["id"]},
        {
            "$set": {
                "availableMilliCredits": 50_000,
                "includedMilliCredits": 0,
                "purchasedMilliCredits": 50_000,
            }
        },
    )

    response = client.get(
        "/api/credits/quote?roomId=meter-room&mode=AI_FACE&quality=LOW"
    )

    assert response.status_code == 403
    assert "active trial or paid subscription" in response.json()["message"]
