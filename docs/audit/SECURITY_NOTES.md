# Security Notes

- Argon2 password hashes and revocable database-backed sessions.
- HTTP-only SameSite cookies and double-submit CSRF on mutations.
- Expiring signed room invites and private file URLs.
- One-time signed uploads with signature and file-magic validation.
- Face-object ownership checks and physical biometric deletion.
- AES-256-GCM provider credential storage with fingerprints only in UI.
- Recent-login requirement for provider changes and RBAC on admin mutations.
- Signed payment webhooks, exact NGN amount checks and idempotent grants.
- Production startup rejects default/weak auth and vault keys.
- Request IDs, coded API errors and unhandled stack logging.
- Host allowlisting, CSP, HSTS, clickjacking and MIME-sniffing headers.

Open controls before public launch:

- enforce administrator TOTP MFA
- add trusted server-side AI usage telemetry
- self-host/pin MediaPipe WASM/model assets to reduce CDN dependency
- run external penetration and mobile-device acceptance tests
- configure backup, restore, alerting and incident-response procedures

Dependency note:

- `pip-audit` reports `PYSEC-2026-161` against Starlette `0.49.3`. The fixed
  Starlette `1.0.1` line is not yet accepted by FastAPI's current
  `<0.51.0` constraint. The backend rejects unapproved raw Host headers before
  routing as a compensating control. Upgrade FastAPI/Starlette when a compatible
  fixed release is available.
