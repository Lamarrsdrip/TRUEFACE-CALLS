from __future__ import annotations

CONFIGURED = "CONFIGURED"
PARTIALLY_CONFIGURED = "PARTIALLY_CONFIGURED"
UNCONFIGURED = "UNCONFIGURED"


def apply_provider_defaults(provider: str, values: dict[str, str]) -> dict[str, str]:
    result = dict(values)
    if provider == "storage" and not result:
        result = {
            "provider": "gridfs",
            "managedBy": "Emergent MongoDB",
        }
    if provider == "ai":
        result.setdefault("enabled", "true")
        result.setdefault("provider", "emergent")
        result.setdefault("mode", "hybrid")
        result.setdefault("creditsPath", "/credits")
        result.setdefault("healthPath", "/health")
    if provider == "email" and result.get("provider") == "gmail":
        result.setdefault("host", "smtp.gmail.com")
        result.setdefault("port", "465")
        result.setdefault("secure", "ssl")
    return result


def provider_configuration_status(
    provider: str, values: dict[str, str]
) -> str:
    effective = apply_provider_defaults(provider, values)
    if provider == "storage" and effective.get("provider") == "gridfs":
        return CONFIGURED
    if not effective:
        return UNCONFIGURED

    enabled = effective.get("enabled")
    if enabled is not None and enabled.lower() != "true":
        return UNCONFIGURED

    required = _required_fields(provider, effective)
    if not required:
        return CONFIGURED if _has_meaningful_value(effective) else UNCONFIGURED
    present = {key for key in required if effective.get(key)}
    if present == required:
        return CONFIGURED
    return PARTIALLY_CONFIGURED


def _required_fields(provider: str, values: dict[str, str]) -> set[str]:
    if provider == "livekit":
        return {"url", "apiKey", "apiSecret"}
    if provider == "storage":
        storage_provider = values.get("provider", "gridfs")
        if storage_provider in {"s3", "r2"}:
            return {
                "provider",
                "endpoint",
                "bucket",
                "accessKey",
                "secretAccessKey",
            }
        return {"provider"}
    if provider in {"paystack", "flutterwave"}:
        return {"secretKey"}
    if provider == "email":
        email_provider = values.get("provider")
        if email_provider == "gmail":
            return {"provider", "senderEmail", "senderName", "appPassword"}
        if email_provider == "smtp":
            return {
                "provider",
                "senderEmail",
                "senderName",
                "host",
                "port",
                "username",
                "password",
                "secure",
            }
        if email_provider == "resend":
            return {"provider", "senderEmail", "senderName", "apiKey"}
        return {"provider"}
    if provider == "ai":
        mode = values.get("mode", "hybrid")
        if mode == "browser":
            return {"enabled", "provider", "mode"}
        return {
            "enabled",
            "provider",
            "mode",
            "gatewayUrl",
            "universalKey",
        }
    if provider == "gpu":
        return {"provider", "endpoint", "apiKey"}
    if provider == "manual-bank":
        return {"enabled", "bankName", "accountName", "accountNumber"}
    if provider == "monitoring":
        return {"dsn"}
    if provider == "whatsapp":
        return {"phoneNumberId", "businessAccountId", "token", "verifyToken"}
    return set()


def _has_meaningful_value(values: dict[str, str]) -> bool:
    return any(str(value).strip() for value in values.values())
