from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from urllib.parse import urlparse


DEVELOPMENT_AUTH_SECRET = "development-auth-secret-change-me"
DEVELOPMENT_SETTINGS_KEY = base64.b64encode(
    b"development-settings-key-32bytes"
).decode()


@dataclass(frozen=True)
class Settings:
    mongo_url: str
    db_name: str
    auth_secret: str
    settings_master_key: str
    app_url: str
    bootstrap_admin_email: str | None
    bootstrap_admin_password: str | None
    allowed_hosts: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        app_url = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
        auth_secret = os.getenv("AUTH_SECRET", DEVELOPMENT_AUTH_SECRET)
        master_key = os.getenv("SETTINGS_MASTER_KEY") or DEVELOPMENT_SETTINGS_KEY
        hostname = (urlparse(app_url).hostname or "").lower()
        production = hostname not in {"localhost", "127.0.0.1", "::1"}
        if production and (
            auth_secret == DEVELOPMENT_AUTH_SECRET or len(auth_secret) < 32
        ):
            raise RuntimeError(
                "AUTH_SECRET must be a unique value of at least 32 characters "
                "outside local development."
            )
        try:
            decoded_master_key = base64.b64decode(master_key, validate=True)
        except Exception as error:
            raise RuntimeError(
                "SETTINGS_MASTER_KEY must be valid base64 for exactly 32 bytes."
            ) from error
        if len(decoded_master_key) != 32:
            raise RuntimeError(
                "SETTINGS_MASTER_KEY must decode to exactly 32 bytes."
            )
        if production and master_key == DEVELOPMENT_SETTINGS_KEY:
            raise RuntimeError(
                "SETTINGS_MASTER_KEY must be unique outside local development."
            )
        return cls(
            mongo_url=os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017"),
            db_name=os.getenv("DB_NAME", "trueface"),
            auth_secret=auth_secret,
            settings_master_key=master_key,
            app_url=app_url,
            bootstrap_admin_email=os.getenv("BOOTSTRAP_ADMIN_EMAIL"),
            bootstrap_admin_password=os.getenv("BOOTSTRAP_ADMIN_PASSWORD"),
            allowed_hosts=tuple(
                dict.fromkeys(
                    [
                        hostname,
                        *(
                            item.strip().lower()
                            for item in os.getenv("ALLOWED_HOSTS", "").split(",")
                            if item.strip()
                        ),
                        *(
                            ["localhost", "127.0.0.1", "::1", "testserver"]
                            if not production
                            else []
                        ),
                    ]
                )
            ),
        )
