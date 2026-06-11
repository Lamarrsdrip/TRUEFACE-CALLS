# Security Notes

- Passwords use Argon2id.
- Access and refresh tokens use HTTP-only same-site cookies.
- Mutations require a double-submit CSRF token.
- Authentication and APIs are globally rate limited.
- Production refuses to start without a 32-character `AUTH_SECRET` and
  `SETTINGS_MASTER_KEY`.
- Provider secrets are encrypted with AES-256-GCM and displayed only as
  fingerprints.
- Invite links are signed, versioned, and expiring.
- Face and payment-proof objects are private and use short-lived signed URLs.
- Admin routes require an active admin record plus method-level role
  permissions for sensitive mutations.
- Admin login, provider changes, payment decisions, credit adjustments, plan
  changes, moderation, face deletion, settings, and call termination are
  audited.
- Consent can be revoked and face objects can be deleted on request.
- Raw camera publication is stopped before processed AI output is published.

Before launch, rotate all bootstrap credentials, enable MFA enforcement,
configure CSP for final provider domains, run an external penetration test,
and configure backup/restore drills.
