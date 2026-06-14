from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import hmac
import logging
import time
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

import jwt
from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from pymongo import MongoClient, ReturnDocument

try:
    from .app.config import Settings
    from .app.routers.admin import router as admin_router
    from .app.routers.ai_face import router as ai_face_router
    from .app.routers.auth import router as auth_router
    from .app.routers.billing import router as billing_router
    from .app.routers.credits import router as credits_router
    from .app.routers.faces import router as faces_router
    from .app.routers.notifications import router as notifications_router
    from .app.routers.providers import router as providers_router
    from .app.routers.rooms import router as rooms_router
    from .app.routers.safety import router as safety_router
    from .app.routers.system import router as system_router
    from .app.seed import seed_database
    from .app.serializers import utc_now
    from .app.vault import SecretVault
except ImportError:
    from app.config import Settings
    from app.routers.admin import router as admin_router
    from app.routers.ai_face import router as ai_face_router
    from app.routers.auth import router as auth_router
    from app.routers.billing import router as billing_router
    from app.routers.credits import router as credits_router
    from app.routers.faces import router as faces_router
    from app.routers.notifications import router as notifications_router
    from app.routers.providers import router as providers_router
    from app.routers.rooms import router as rooms_router
    from app.routers.safety import router as safety_router
    from app.routers.system import router as system_router
    from app.seed import seed_database
    from app.serializers import utc_now
    from app.vault import SecretVault
LOGGER = logging.getLogger("trueface.api")


class StrictHostMiddleware:
    def __init__(self, app, allowed_hosts: tuple[str, ...]):
        self.app = app
        self.allowed_hosts = {host.lower() for host in allowed_hosts if host}

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            raw_hosts = [
                value
                for key, value in scope.get("headers", [])
                if key.lower() == b"host"
            ]
            host = _normalized_host(raw_hosts[0] if len(raw_hosts) == 1 else b"")
            if not host or host not in self.allowed_hosts:
                response = JSONResponse(
                    status_code=400,
                    content={
                        "message": "Invalid request host",
                        "code": "INVALID_HOST",
                    },
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


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
    application.add_middleware(
        StrictHostMiddleware,
        allowed_hosts=settings.allowed_hosts,
    )
    application.state.settings = settings
    application.state.db = database
    application.state.vault = SecretVault(settings.settings_master_key)
    application.state.decode_token = lambda token: jwt.decode(
        token, settings.auth_secret, algorithms=["HS256"]
    )
    application.state.sign_upload = lambda object_key, content_type: _sign_upload(
        settings.auth_secret, object_key, content_type
    )
    application.state.verify_upload = (
        lambda object_key, content_type, token: _verify_upload(
            settings.auth_secret, object_key, content_type, token
        )
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
        request.state.request_id = request.headers.get("x-request-id") or str(
            uuid.uuid4()
        )
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
        response = await call_next(request)
        response.headers["x-request-id"] = request.state.request_id
        return response

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        detail = error.detail
        if isinstance(detail, dict):
            message = str(detail.get("message", "Request failed"))
            code = str(detail.get("code", "REQUEST_FAILED"))
        else:
            message = str(detail)
            code = "REQUEST_FAILED"
        return JSONResponse(
            status_code=error.status_code,
            content={
                "message": message,
                "code": code,
                "requestId": getattr(request.state, "request_id", None),
            },
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        first = error.errors()[0] if error.errors() else {}
        return JSONResponse(
            status_code=422,
            content={
                "message": str(first.get("msg", "Invalid request")),
                "code": "VALIDATION_FAILED",
                "requestId": getattr(request.state, "request_id", None),
            },
        )

    @application.exception_handler(Exception)
    async def unhandled_error(request: Request, error: Exception):
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        LOGGER.error(
            "Unhandled API error request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
            exc_info=(type(error), error, error.__traceback__),
        )
        return JSONResponse(
            status_code=500,
            content={
                "message": (
                    "An unexpected server error occurred. "
                    f"Support reference: {request_id}"
                ),
                "code": "INTERNAL_ERROR",
                "requestId": request_id,
            },
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
    application.include_router(ai_face_router)
    application.include_router(providers_router)
    application.include_router(credits_router)
    application.include_router(billing_router)
    application.include_router(rooms_router)
    application.include_router(faces_router)
    application.include_router(safety_router)
    application.include_router(system_router)
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


def _sign_upload(secret: str, object_key: str, content_type: str) -> str:
    expires = int(time.time()) + 900
    signature = hmac.new(
        secret.encode(),
        f"upload:{object_key}:{content_type}:{expires}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{expires}.{signature}"


def _verify_upload(
    secret: str, object_key: str, content_type: str, token: str
) -> bool:
    try:
        expires_text, signature = token.split(".", 1)
        expires = int(expires_text)
        if expires < int(time.time()):
            return False
        expected = hmac.new(
            secret.encode(),
            f"upload:{object_key}:{content_type}:{expires}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception:
        return False


app = create_app()


def _normalized_host(raw_host: bytes) -> str:
    try:
        value = raw_host.decode("ascii", "strict").strip()
        if not value or any(character in value for character in "\r\n\t /\\@"):
            return ""
        parsed = urlsplit(f"//{value}")
        return (parsed.hostname or "").lower()
    except Exception:
        return ""
