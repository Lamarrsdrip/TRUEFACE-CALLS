# Production Readiness

The repository is a production-oriented SaaS foundation, not a no-operations
claim. It includes migrations, seed data, health endpoints, provider
configuration, encrypted secrets, audit logs, billing invariants, responsive
UI, Docker support, and deterministic build/start commands.

## Required Launch Checklist

1. Provision PostgreSQL, Redis, and S3-compatible storage.
2. Set all required environment variables in Emergent.
3. Deploy and sign in at `/admin/login` with the bootstrap admin.
4. Rotate the bootstrap password.
5. Configure and test LiveKit, storage, email, and payment providers.
6. Review plans, credit packs, rates, reset rules, and cost assumptions.
7. Configure bank transfer or disable it.
8. Register payment webhooks against the production URL.
9. Exercise signup, subscription, top-up, room, face, deletion, abuse, and
   refund procedures with real sandbox providers.
10. Enable monitoring, backups, incident alerts, and a retention policy.

Emergent can handle repository import, application build, service hosting,
HTTPS, deployment, environment injection, preview/production URLs, and
platform monitoring where available. External provider accounts and keys are
still required.
