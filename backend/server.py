from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import hmac
import time
from datetime import timedelta

import jwt
from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from pymongo import MongoClient, ReturnDocument

try:
    from .app.config import Settings
    from .app.routers.admin import router as admin_router
    from .app.routers.auth import router as auth_router
    from .app.routers.billing import router as billing_router
    from .app.routers.credits import router as credits_router
    from .app.routers.faces import router as faces_router
    from .app.routers.notifications import router as notifications_router
    from .app.routers.providers import router as providers_router
    from .app.routers.rooms import router as rooms_router
    from .app.routers.safety import router as safety_router
    from .app.seed import seed_database
    from .app.serializers import utc_now
    from .app.vault import SecretVault
except ImportError:
    from app.config import Settings
    from app.routers.admin import router as admin_router
    from app.routers.auth import router as auth_router
    from app.routers.billing import router as billing_router
    from app.routers.credits import router as credits_router
    from app.routers.faces import router as faces_router
    from app.routers.notifications import router as notifications_router
    from app.routers.providers import router as providers_router
    from app.routers.rooms import router as rooms_router
    from app.routers.safety import router as safety_router
    from app.seed import seed_database
    from app.serializers import utc_now
    from app.vault import SecretVault


def create_app(database=None, master_key: str | None = None) -> FastAPI:
    settings = Settings.from_env()
    if master_key:
        settings = Settings(
            **{
                **settings.__dict__,
                "settings_master_key": master_key,
            }
        )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if application.state.db is None:
            client = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            application.state.mongo_client = client
            application.state.db = client[settings.db_name]
        seed_database(
            application.state.db,
            settings.bootstrap_admin_email,
            settings.bootstrap_admin_password,
        )
        yield
        client = getattr(application.state, "mongo_client", None)
        if client:
            client.close()

    application = FastAPI(
        title="TrueFace Calls API",
        version="0.2.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.db = database
    application.state.vault = SecretVault(settings.settings_master_key)
    application.state.decode_token = lambda token: jwt.decode(
        token, settings.auth_secret, algorithms=["HS256"]
    )
    application.state.sign_upload = lambda object_key: hmac.new(
        settings.auth_secret.encode(),
        f"upload:{object_key}".encode(),
        hashlib.sha256,
    ).hexdigest()
    application.state.verify_upload = lambda object_key, token: hmac.compare_digest(
        application.state.sign_upload(object_key), token
    )
    application.state.sign_download = lambda object_key, expires: (
        f"{expires}."
        + hmac.new(
            settings.auth_secret.encode(),
            f"download:{object_key}:{expires}".encode(),
            hashlib.sha256,
        ).hexdigest()
    )
    application.state.verify_download = lambda object_key, token: _verify_download(
        settings.auth_secret, object_key, token
    )

    @application.middleware("http")
    async def csrf_guard(request: Request, call_next):
        if application.state.db is not None:
            limit = (
                5
                if request.url.path == "/api/auth/admin-login"
                else 20
                if request.url.path in {"/api/auth/login", "/api/auth/signup"}
                else 180
            )
            minute = int(time.time() // 60)
            identity = hashlib.sha256(
                f"{request.client.host if request.client else 'unknown'}:{request.url.path}:{minute}".encode()
            ).hexdigest()
            record = application.state.db.rate_limits.find_one_and_update(
                {"key": identity},
                {
                    "$inc": {"count": 1},
                    "$setOnInsert": {
                        "key": identity,
                        "expiresAt": utc_now() + timedelta(minutes=2),
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            if record["count"] > limit:
                return JSONResponse(
                    status_code=429,
                    content={"message": "Too many requests. Try again shortly."},
                )
        if (
            request.method not in {"GET", "HEAD", "OPTIONS"}
            and not request.url.path.startswith("/api/webhooks/")
            and not request.url.path.startswith("/api/uploads/")
        ):
            cookie = request.cookies.get("tf_csrf")
            header = request.headers.get("x-csrf-token")
            if not cookie or not header or cookie != header:
                return JSONResponse(
                    status_code=403, content={"message": "Invalid CSRF token"}
                )
        return await call_next(request)

    @application.exception_handler(HTTPException)
    async def http_error(_request: Request, error: HTTPException):
        return JSONResponse(
            status_code=error.status_code,
            content={"message": str(error.detail)},
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError):
        first = error.errors()[0] if error.errors() else {}
        return JSONResponse(
            status_code=422,
            content={"message": str(first.get("msg", "Invalid request"))},
        )

    @application.get("/api/health")
    def health() -> dict[str, str]:
        connected = "connected" if application.state.db is not None else "not-connected"
        return {
            "status": "ok",
            "runtime": "emergent-native",
            "database": connected,
        }

    application.include_router(auth_router)
    application.include_router(providers_router)
    application.include_router(credits_router)
    application.include_router(billing_router)
    application.include_router(rooms_router)
    application.include_router(faces_router)
    application.include_router(safety_router)
    application.include_router(notifications_router)
    application.include_router(admin_router)
    return application


def _verify_download(secret: str, object_key: str, token: str) -> bool:
    try:
        expires_text, signature = token.split(".", 1)
        expires = int(expires_text)
        if expires < int(time.time()):
            return False
        expected = hmac.new(
            secret.encode(),
            f"download:{object_key}:{expires}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception:
        return False


app = create_app()
