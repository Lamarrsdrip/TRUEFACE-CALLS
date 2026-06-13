# Emergent Deployment Report

## Deployment Recommendation

Deploy the current product on Emergent only if the preview accepts the custom
Node/Docker runtime and external service URLs. This preserves the working SaaS
foundation and avoids a risky database/backend rewrite.

## Required Build And Start

Build:

```bash
npm ci && npm run db:generate && npm run build
```

Start:

```bash
npm run start:deploy
```

## Required Environment Variables

- `NODE_ENV=production`
- `APP_URL`
- `API_URL`
- `API_INTERNAL_URL`
- `API_PORT=4000`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `AUTH_SECRET`
- `SETTINGS_MASTER_KEY`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

## Provider Setup After Deploy

Configure these from Admin when possible:

- LiveKit URL, API key, and API secret.
- Storage endpoint, bucket, region, access key, and secret.
- Email provider and sender identity.
- Stripe, Paystack, Flutterwave, or manual bank-transfer details.
- Optional GPU provider settings.
- Plan limits, credit packs, cost assumptions, branding, and safety settings.

## Compatibility Status

- Next.js app: compatible with Emergent if Node/Next build is supported.
- NestJS API: compatible only with custom runtime or separate API hosting.
- PostgreSQL/Prisma: requires external managed PostgreSQL.
- Redis: requires managed Redis.
- S3: requires managed S3-compatible private object storage.
- MongoDB-only runtime: requires the migration plan.

## Production Readiness Score

Post-hardening score: 82/100.

The score is held down by missing real-provider LiveKit/payment acceptance
tests, no admin MFA enforcement, production infrastructure still needing
provisioning, and unconfirmed Emergent custom-runtime support.
