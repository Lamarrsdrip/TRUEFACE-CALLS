from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException


class InviteSigner:
    def __init__(self, secret: str):
        self.secret = secret.encode()

    def sign(self, room_id: str, version: int, expires_at: int) -> str:
        payload = base64.urlsafe_b64encode(
            json.dumps(
                {"roomId": room_id, "inviteVersion": version, "exp": expires_at},
                separators=(",", ":"),
            ).encode()
        ).decode().rstrip("=")
        signature = base64.urlsafe_b64encode(
            hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        return f"{payload}.{signature}"

    def verify(self, token: str, room_id: str, version: int) -> dict:
        try:
            payload, signature = token.split(".", 1)
            expected = base64.urlsafe_b64encode(
                hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()
            ).decode().rstrip("=")
            if not hmac.compare_digest(expected, signature):
                raise ValueError("signature")
            parsed = json.loads(
                base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
            )
            if (
                parsed["roomId"] != room_id
                or parsed["inviteVersion"] != version
                or parsed["exp"] < int(time.time())
            ):
                raise ValueError("claims")
            return parsed
        except Exception as error:
            raise HTTPException(status_code=403, detail="Invite is invalid or expired") from error
