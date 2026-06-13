# TrueFace Calls Emergent-Native Design

## Objective

Create a production-oriented `codex/emergent-native` branch that Emergent can
pull directly without changing the architecture during import. Preserve the
working `codex/trueface-foundation` branch as the Node/PostgreSQL fallback.

## Platform Contract

The branch follows Emergent's supported repository layout:

- `frontend/`: standalone Next.js application.
- `backend/`: FastAPI application listening on port `8001`.
- Browser API traffic uses the same-origin `/api` prefix.
- FastAPI routes live below `/api`.
- MongoDB uses `MONGO_URL` and `DB_NAME`.
- Face images and payment proofs default to private MongoDB GridFS storage.

No PostgreSQL, Prisma, NestJS, Redis, S3, custom Docker runtime, or custom
root-level process manager is required for the Emergent deployment.

## Frontend

The existing mobile-first Next.js UI, call room, MediaPipe/WebGL processing,
LiveKit client integration, billing screens, face management, and admin
console are retained.

The frontend becomes standalone:

- Internal workspace packages used by the browser are moved into local modules.
- `/api/:path*` proxies to FastAPI's `/api/:path*`.
- Local development defaults to `http://127.0.0.1:8001`.
- Production uses Emergent's single ingress.

## Backend Boundaries

FastAPI is split into focused routers:

- Authentication and account privacy.
- Rooms, waiting room admission, signed invites, and LiveKit tokens.
- Credit wallet, reservations, usage settlement, and quotes.
- Plans, subscriptions, provider checkout, and manual bank transfers.
- Face profiles, multiple images, quality/readiness, consent, and deletion.
- Notifications, blocking, and abuse reports.
- Admin users, payments, plans, moderation, settings, provider health, audit
  logs, and deployment status.

Shared services provide:

- MongoDB indexes and startup seeding.
- JWT access/refresh sessions in HTTP-only cookies.
- CSRF validation for state-changing browser requests.
- MongoDB-backed fixed-window rate limiting.
- AES-GCM encryption for provider credentials using
  `SETTINGS_MASTER_KEY`.
- Private GridFS uploads/downloads with authenticated access.
- Provider adapters for LiveKit, Stripe, Paystack, Flutterwave, SMTP/API email,
  external S3/R2, and future GPU workers.

## MongoDB Collections

Collections mirror the existing product domain:

- `users`, `sessions`, `auth_tokens`, `devices`
- `face_profiles`, `face_profile_images`, `consent_logs`,
  `face_moderation_events`
- `call_rooms`, `call_participants`, `call_history`, `call_events`
- `plans`, `subscriptions`, `payments`, `refunds`
- `credit_wallets`, `credit_transactions`, `usage_minutes`
- `abuse_reports`, `blocked_users`
- `admin_users`, `audit_logs`, `notifications`
- `app_settings`, `provider_health`, `webhook_events`
- GridFS `uploads.files` and `uploads.chunks`

Identifiers are UUID strings. Money remains integer minor units. Credits remain
integer milli-credits. Ledger writes use idempotency keys and MongoDB atomic
updates. Multi-document payment approval and subscription activation use
transactions when the managed MongoDB topology supports them, with
idempotent compensation when transactions are unavailable.

## External Providers

Provider credentials are not required at initial deployment. Super admins
configure them later at `/admin/providers`.

The admin console supports:

- LiveKit URL, key, secret, mode, connection test, and health.
- Stripe, Paystack, and Flutterwave test/live credentials and webhook status.
- Manual bank-transfer details and review policy.
- Email provider/API or SMTP configuration and test delivery.
- GridFS, S3, or R2 storage settings and test upload/delete.
- RunPod, Modal, AWS, Replicate, or custom GPU endpoint settings and tests.
- Monitoring configuration.

Secrets are encrypted before MongoDB storage, never returned in plaintext,
displayed only as fingerprints, excluded from logs, and audited on every
change.

## Security

- Passwords use Argon2.
- Access and refresh tokens are signed separately and stored in HTTP-only,
  secure, same-site cookies.
- Refresh tokens are hashed in MongoDB and rotated.
- CSRF uses a readable cookie plus matching request header.
- Admin routes require active admin membership and permission checks.
- Secret changes require recent admin authentication.
- Call invites are signed and expire.
- Face files are private and served only after authorization.
- Consent records are immutable; revocation and deletion are separate events.
- Manual payment approval is the only action that activates manual purchases.
- Webhook handlers verify provider signatures and enforce event idempotency.
- Rate limits are persisted in MongoDB.

## Deployment And Startup

Emergent runs:

- Frontend with its normal Next.js build/start lifecycle.
- Backend with `uvicorn server:app --host 0.0.0.0 --port 8001`.

Backend startup creates indexes and idempotently seeds default plans, cost
settings, a trial wallet policy, and the bootstrap super admin when bootstrap
credentials are supplied.

Required environment:

- `MONGO_URL`
- `DB_NAME`
- `AUTH_SECRET`
- `SETTINGS_MASTER_KEY`
- `APP_URL`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Optional provider values remain configurable in the admin dashboard.

## Testing And Acceptance

Pytest covers authentication, encrypted settings, subscription gating,
credit ledger idempotency, manual payment approval, room persistence,
host/guest admission, consent enforcement, and private storage authorization.

Frontend tests and type checking remain. Acceptance requires:

- Backend tests pass.
- Frontend tests and build pass.
- Signup/login and admin login work.
- Provider settings save only encrypted values.
- Subscription and top-up rules are enforced.
- Call rooms persist and generate distinct host/invite URLs.
- Manual payments remain pending until admin approval.
- Face profiles require consent and respect plan limits.
- `/api/health` reports MongoDB connectivity.

## Explicit Limitations

Deployment can be fully hosted by Emergent, but real video transport, gateway
payments, transactional email, and cloud GPU inference remain external
services. The application is deployable before those keys exist and exposes
clear `UNCONFIGURED` provider states instead of simulated success.
