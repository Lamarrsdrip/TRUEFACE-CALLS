from __future__ import annotations

import uuid
from datetime import timedelta

from argon2 import PasswordHasher
from pymongo.database import Database

from .serializers import utc_now

PASSWORDS = PasswordHasher()

DEFAULT_PLANS = [
    {
        "key": "trial",
        "name": "Free Trial",
        "description": "Short consent-first product evaluation.",
        "monthlyCredits": 1500,
        "maxFaceProfiles": 1,
        "maxImagesPerProfile": 2,
        "maxParticipants": 2,
        "maxCallMinutes": 1,
        "maxGroupCalls": 0,
        "allowedQualities": ["LOW", "STANDARD"],
        "groupCalls": False,
        "watermarkRequired": True,
        "creditTopupsAllowed": False,
        "creditResetDays": 30,
        "voiceEffects": False,
        "cloudGpu": False,
        "priceMonthlyMinor": 0,
        "currency": "NGN",
        "sortOrder": 0,
        "enabled": True,
    },
    {
        "key": "basic",
        "name": "Basic",
        "description": "Standard individual AI calling.",
        "monthlyCredits": 60000,
        "maxFaceProfiles": 3,
        "maxImagesPerProfile": 5,
        "maxParticipants": 2,
        "maxCallMinutes": 60,
        "maxGroupCalls": 0,
        "allowedQualities": ["LOW", "STANDARD"],
        "groupCalls": False,
        "watermarkRequired": True,
        "creditTopupsAllowed": True,
        "creditResetDays": 30,
        "voiceEffects": False,
        "cloudGpu": False,
        "priceMonthlyMinor": 990_000,
        "currency": "NGN",
        "sortOrder": 10,
        "enabled": True,
    },
    {
        "key": "pro",
        "name": "Pro",
        "description": "HD and group calls for creators and professionals.",
        "monthlyCredits": 240000,
        "maxFaceProfiles": 10,
        "maxImagesPerProfile": 8,
        "maxParticipants": 8,
        "maxCallMinutes": 240,
        "maxGroupCalls": 100,
        "allowedQualities": ["LOW", "STANDARD", "HD"],
        "groupCalls": True,
        "watermarkRequired": True,
        "creditTopupsAllowed": True,
        "creditResetDays": 30,
        "voiceEffects": True,
        "cloudGpu": True,
        "priceMonthlyMinor": 2_490_000,
        "currency": "NGN",
        "sortOrder": 20,
        "enabled": True,
    },
    {
        "key": "business",
        "name": "Business",
        "description": "Team controls, analytics, and priority processing.",
        "monthlyCredits": 1000000,
        "maxFaceProfiles": 50,
        "maxImagesPerProfile": 10,
        "maxParticipants": 25,
        "maxCallMinutes": 480,
        "maxGroupCalls": 1000,
        "allowedQualities": ["LOW", "STANDARD", "HD"],
        "groupCalls": True,
        "watermarkRequired": True,
        "creditTopupsAllowed": True,
        "creditResetDays": 30,
        "voiceEffects": True,
        "cloudGpu": True,
        "priceMonthlyMinor": 7_490_000,
        "currency": "NGN",
        "sortOrder": 30,
        "enabled": True,
    },
]

DEFAULT_CREDIT_PACKS = [
    {
        "key": "starter",
        "name": "Starter credits",
        "creditsMilli": 50_000,
        "priceMinor": 250_000,
        "currency": "NGN",
    },
    {
        "key": "growth",
        "name": "Growth credits",
        "creditsMilli": 250_000,
        "priceMinor": 1_000_000,
        "currency": "NGN",
    },
    {
        "key": "scale",
        "name": "Scale credits",
        "creditsMilli": 1_000_000,
        "priceMinor": 3_500_000,
        "currency": "NGN",
    },
]


def ensure_indexes(db: Database) -> None:
    db.users.create_index("email", unique=True)
    db.sessions.create_index("refreshTokenHash", unique=True)
    db.auth_tokens.create_index("tokenHash", unique=True)
    db.plans.create_index("key", unique=True)
    db.subscriptions.create_index("id", unique=True)
    db.call_rooms.create_index("slug", unique=True)
    db.credit_wallets.create_index("userId", unique=True)
    db.credit_transactions.create_index("idempotencyKey", unique=True)
    db.usage_minutes.create_index("meteringWindow", unique=True)
    db.payments.create_index("idempotencyKey", unique=True)
    db.payments.create_index("paymentReference", unique=True, sparse=True)
    db.webhook_events.create_index(
        [("provider", 1), ("externalId", 1)], unique=True, sparse=True
    )
    db.app_settings.create_index([("namespace", 1), ("key", 1)], unique=True)
    db.provider_health.create_index("provider", unique=True)
    db.blocked_users.create_index([("blockerId", 1), ("blockedId", 1)], unique=True)
    db.notification_reads.create_index(
        [("notificationId", 1), ("userId", 1)], unique=True
    )
    db.rate_limits.create_index("expiresAt", expireAfterSeconds=0)


def seed_database(
    db: Database,
    admin_email: str | None = None,
    admin_password: str | None = None,
) -> None:
    ensure_indexes(db)
    now = utc_now()
    for plan in DEFAULT_PLANS:
        existing = db.plans.find_one({"key": plan["key"]})
        if not existing:
            db.plans.insert_one(
                {
                    **plan,
                    "id": str(uuid.uuid4()),
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
        elif existing.get("currency") != "NGN":
            db.plans.update_one(
                {"id": existing["id"]},
                {
                    "$set": {
                        "currency": "NGN",
                        "priceMonthlyMinor": plan["priceMonthlyMinor"],
                        "updatedAt": now,
                    }
                },
            )
    credit_setting = db.app_settings.find_one(
        {"namespace": "billing", "key": "credit-packs"}
    )
    if not credit_setting:
        db.app_settings.insert_one(
            {
                "id": str(uuid.uuid4()),
                "namespace": "billing",
                "key": "credit-packs",
                "publicValue": {"packs": DEFAULT_CREDIT_PACKS},
                "version": 1,
                "createdAt": now,
                "updatedAt": now,
            }
        )
    else:
        packs = credit_setting.get("publicValue", {}).get("packs", [])
        defaults = {pack["key"]: pack for pack in DEFAULT_CREDIT_PACKS}
        migrated = []
        changed = False
        for pack in packs:
            if pack.get("currency") == "NGN":
                migrated.append(pack)
                continue
            default = defaults.get(pack.get("key"))
            migrated.append(default or {**pack, "currency": "NGN"})
            changed = True
        if changed:
            db.app_settings.update_one(
                {"_id": credit_setting["_id"]},
                {
                    "$set": {
                        "publicValue.packs": migrated,
                        "updatedAt": now,
                    }
                },
            )
    if not admin_email or not admin_password:
        return
    email = admin_email.strip().lower()
    user = db.users.find_one({"email": email})
    if not user:
        user_id = str(uuid.uuid4())
        user = {
            "id": user_id,
            "email": email,
            "passwordHash": PASSWORDS.hash(admin_password),
            "displayName": "TrueFace Administrator",
            "status": "ACTIVE",
            "emailVerifiedAt": now,
            "locale": "en",
            "timezone": "UTC",
            "roomCreationDisabled": False,
            "createdAt": now,
            "updatedAt": now,
        }
        db.users.insert_one(user)
        trial = db.plans.find_one({"key": "trial"})
        db.subscriptions.insert_one(
            {
                "id": str(uuid.uuid4()),
                "userId": user_id,
                "planId": trial["id"],
                "provider": "MANUAL",
                "status": "TRIALING",
                "currentPeriodStart": now,
                "currentPeriodEnd": now + timedelta(days=5),
                "createdAt": now,
                "updatedAt": now,
            }
        )
        db.credit_wallets.insert_one(
            {
                "id": str(uuid.uuid4()),
                "userId": user_id,
                "availableMilliCredits": trial["monthlyCredits"],
                "reservedMilliCredits": 0,
                "includedMilliCredits": trial["monthlyCredits"],
                "purchasedMilliCredits": 0,
                "reservedIncludedMilli": 0,
                "reservedPurchasedMilli": 0,
                "includedResetAt": now + timedelta(days=30),
                "lifetimePurchasedMilli": 0,
                "lifetimeConsumedMilli": 0,
                "version": 0,
                "createdAt": now,
                "updatedAt": now,
            }
        )
    db.admin_users.update_one(
        {"userId": user["id"]},
        {
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "userId": user["id"],
                "role": "SUPER_ADMIN",
                "permissions": ["*"],
                "mfaRequired": True,
                "mfaEnabled": False,
                "active": True,
                "createdAt": now,
                "updatedAt": now,
            }
        },
        upsert=True,
    )
