from __future__ import annotations

import base64
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mongo_url: str
    db_name: str
    auth_secret: str
    settings_master_key: str
    app_url: str
    bootstrap_admin_email: str | None
    bootstrap_admin_password: str | None

    @classmethod
    def from_env(cls) -> "Settings":
        auth_secret = os.getenv("AUTH_SECRET", "development-auth-secret-change-me")
        master_key = os.getenv("SETTINGS_MASTER_KEY")
        if not master_key:
            master_key = base64.b64encode(
                b"development-settings-key-32bytes"
            ).decode()
        return cls(
            mongo_url=os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017"),
            db_name=os.getenv("DB_NAME", "trueface"),
            auth_secret=auth_secret,
            settings_master_key=master_key,
            app_url=os.getenv("APP_URL", "http://localhost:3000").rstrip("/"),
            bootstrap_admin_email=os.getenv("BOOTSTRAP_ADMIN_EMAIL"),
            bootstrap_admin_password=os.getenv("BOOTSTRAP_ADMIN_PASSWORD"),
        )
