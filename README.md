# TrueFace Calls

Consent-first, mobile-first AI face controls for secure browser video calls.

TrueFace Calls is a production SaaS foundation built with Next.js, NestJS,
PostgreSQL, Prisma, LiveKit, MediaPipe, S3-compatible storage, Stripe,
Paystack, and Flutterwave.

## Product Safety

- Every face profile requires ownership, permission, and terms acceptance.
- Consent is recorded as a versioned, revocable audit record.
- AI face mode is disclosed in the room UI and participant metadata.
- Raw camera publication stops before the processed track is published.
- Tracking failures pause AI output instead of hiding uncertainty.
- Face deletion removes storage objects and revokes consent.
- Abuse reporting, user blocking, moderation queues, and admin audit logs are
  built in.

## Repository

```text
apps/web                 Next.js customer and admin applications
apps/api                 NestJS API and provider orchestration
packages/contracts       Shared validation, plan, billing, and device policy
packages/database        Prisma schema, migrations, and idempotent seed
packages/media-engine    Browser processing and publication state machine
packages/providers       Credential vault and provider abstractions
docs                     Architecture, implementation, and deployment guides
```

## Local Setup

Requirements: Node.js 22+, npm 10+, PostgreSQL 16+, Redis 7+, and
S3-compatible object storage.

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. The API is available through the same-origin
`/api` rewrite and directly on `http://localhost:4000/v1`.

## Commands

```bash
npm run test
npm run typecheck
npm run build
npm run start
npm run start:deploy
npm run db:migrate:deploy
npm run db:seed
```

`start:deploy` applies committed migrations, runs the idempotent seed, and
starts the web and API processes.

## Required Environment

- `NODE_ENV`
- `APP_URL`
- `API_URL`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `AUTH_SECRET` (32+ random characters)
- `SETTINGS_MASTER_KEY` (base64 encoded 32-byte key)
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Optional preview account:

- `BOOTSTRAP_PREVIEW_EMAIL`
- `BOOTSTRAP_PREVIEW_PASSWORD`

Provider credentials can be supplied as environment fallbacks or saved after
deployment in **Admin > Providers**. Admin-saved secrets are encrypted with
AES-256-GCM and are returned only as fingerprints.

## Provider Setup

1. Sign in with the bootstrap admin.
2. Open `/admin/providers`.
3. Configure and test LiveKit, S3 storage, email, and payment providers.
4. Configure GPU providers only when cloud processing workers are available.
5. Open `/admin/plans` to edit prices, credits, and entitlement limits.
6. Open `/admin/settings` for branding, moderation, and product policy JSON.

LiveKit Cloud is the recommended launch provider. The storage adapter supports
Emergent-compatible S3 storage now and S3, R2, MinIO, or another compatible
provider later.

## Emergent Deployment

The repository includes a production Dockerfile and provider-agnostic runtime
contract. Emergent handles application build, container hosting, HTTPS,
preview/production URLs, deployment, and environment secret injection.

Emergent currently documents MongoDB as its native database. This application
requires PostgreSQL, so provide a managed PostgreSQL `DATABASE_URL` and
`DIRECT_DATABASE_URL`. Use managed Redis and S3-compatible storage in the same
way.

Build command:

```bash
npm ci && npm run db:generate && npm run build
```

Start command:

```bash
npm run start:deploy
```

See [docs/deployment/emergent.md](docs/deployment/emergent.md) for the complete
deployment and provider checklist.

## Production Boundaries

Browser processing currently uses a compositing adapter suitable for approved
avatars and consented face effects. The `FaceProcessor` contract is designed
for a future photorealistic model or GPU worker without changing room,
billing, safety, or publication logic.

Real calls require LiveKit credentials. Payments require at least one supported
payment provider. Transactional email currently supports Resend through the
admin-configured email provider.
