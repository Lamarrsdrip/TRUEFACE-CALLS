# Emergent Compatibility Audit

Audit date: 2026-06-13.

## Executive Finding

The safest launch path is to keep the current Next.js, NestJS, Prisma,
PostgreSQL, Redis, S3, and LiveKit architecture if Emergent accepts a custom
Node/Docker runtime and externally managed PostgreSQL/Redis services.

A rewrite to FastAPI and MongoDB should be treated as a migration project, not
as a deployment tweak. The current product has transactional billing, credit
ledgers, consent records, payment approval flows, and relational room state.
Moving those invariants to MongoDB would carry high launch risk.

## Public Emergent Signal Checked

Emergent's public site describes full-stack app building, deployment, private
project hosting, GitHub integration, and code ownership. The public help site
requires JavaScript and did not expose a crawlable custom-runtime contract in
this audit. Therefore, compatibility must be confirmed in Emergent during
import/preview rather than assumed.

## Can Current App Run On Emergent?

Yes, if Emergent supports:

- Node.js 22+ or the included Dockerfile.
- A long-running process that can expose Next.js on port 3000 and NestJS on
  port 4000.
- Production environment variables.
- External managed PostgreSQL and Redis connection strings.
- Outbound network access to LiveKit, S3 storage, email, and payment providers.

No, not directly, if Emergent only supports its native FastAPI/MongoDB runtime
for imported applications.

## What Blocks Direct Native Deployment?

- Backend is NestJS, not FastAPI.
- Database is Prisma/PostgreSQL, not MongoDB.
- SQL transactions are used for payments, credits, approval decisions, and
  audit records.
- Prisma migrations must run before the API starts.
- LiveKit token generation uses `livekit-server-sdk` in Node.
- S3 signed URL handling uses AWS SDK for JavaScript.

## What Can Stay Unchanged

- Next.js customer/admin UI.
- LiveKit as the video engine.
- Browser-local AI processing strategy.
- Subscription, credit, face-profile, consent, payment, and moderation product
  requirements.
- Provider credential vault concept.
- Admin-configured provider model.

## What Must Be Rewritten For Emergent-Native

- NestJS controllers/services to FastAPI routers/services.
- Prisma schema and migrations to MongoDB collections and indexes.
- Relational joins and nested writes to explicit document queries.
- Credit and payment transactions to MongoDB sessions or compensating ledgers.
- Node LiveKit/S3/payment adapters to Python equivalents.
- Existing Vitest suites to Pytest/FastAPI tests.

## Recommendation

Confirm Emergent custom-runtime support first. If accepted, deploy the current
stack with external managed PostgreSQL/Redis/S3 and keep the product intact.
If rejected, use the migration plan in `EMERGENT_MIGRATION_PLAN.md`.
