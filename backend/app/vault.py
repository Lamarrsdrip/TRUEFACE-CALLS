import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SecretVault:
    def __init__(self, encoded_key: str):
        key = base64.b64decode(encoded_key)
        if len(key) != 32:
            raise ValueError("SETTINGS_MASTER_KEY must encode exactly 32 bytes")
        self._cipher = AESGCM(key)

    def encrypt(self, value: str) -> str:
        nonce = os.urandom(12)
        encrypted = self._cipher.encrypt(nonce, value.encode(), None)
        return base64.urlsafe_b64encode(nonce + encrypted).decode()

    def decrypt(self, value: str) -> str:
        payload = base64.urlsafe_b64decode(value)
        return self._cipher.decrypt(payload[:12], payload[12:], None).decode()

    @staticmethod
    def fingerprint(value: str) -> str:
        return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:16]}"
