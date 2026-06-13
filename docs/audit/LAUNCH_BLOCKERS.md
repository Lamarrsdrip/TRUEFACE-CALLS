# Launch Blockers

## Critical

- LiveKit provider must be configured with real credentials and tested against
  token generation, room join, publish, subscribe, reconnect, and room end.
- Emergent custom-runtime compatibility must be confirmed during import.
- Production PostgreSQL, Redis, and S3-compatible private storage must be
  provisioned.

Resolved in the 2026-06-13 hardening pass:

- Host/guest call admission bug: host links, host token entry, waiting
  participant approval, and safe Prisma participant updates now have focused
  regression tests.

## High

- Admin MFA enrollment/enforcement is not implemented.
- Stripe/Paystack/Flutterwave require provider sandbox and webhook acceptance
  tests.
- CSP must be finalized for production domains and provider endpoints.
- Backups, restore drills, monitoring, and incident alerts must be configured.
- Bootstrap and preview credentials must be rotated before public launch.

## Medium

- Browser AI is a real local processing/compositing pipeline, not a full
  photorealistic GPU face replacement model.
- Multiple face images improve validation/readiness today, but full multi-view
  inference needs a GPU provider.
- `npm audit` reports a nested Next.js/PostCSS advisory; the available forced
  fix is a breaking Next.js downgrade and should wait for an upstream update.
