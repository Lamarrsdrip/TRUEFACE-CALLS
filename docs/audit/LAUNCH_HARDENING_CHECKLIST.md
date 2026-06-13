# Launch Hardening Checklist

- Enforce admin MFA with TOTP or WebAuthn.
- Rotate bootstrap admin and preview credentials.
- Verify payment webhook signatures in sandbox and production.
- Configure final Content Security Policy for app, API, LiveKit, storage,
  payment, and email domains.
- Enable PostgreSQL backups and restore drills.
- Enable Redis persistence or document cache-loss behavior.
- Configure object storage retention and deletion policies.
- Add Sentry or equivalent error monitoring.
- Add uptime checks for web, API, health, LiveKit, storage, and payments.
- Run a security review focused on auth, payments, provider vault, face data,
  signed URLs, CSRF, rate limits, and invite links.
- Document incident response, refund handling, abuse escalation, and data
  deletion procedures.
