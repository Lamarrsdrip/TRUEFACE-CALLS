# Emergent Migration Plan

## Preferred Option: Preserve Current Stack

Use this if Emergent preview accepts the repository build and start commands.

- Build: `npm ci && npm run db:generate && npm run build`
- Start: `npm run start:deploy`
- Database: external managed PostgreSQL.
- Cache/jobs: external managed Redis.
- Storage: S3-compatible private bucket.
- Video: LiveKit Cloud.

This option has the lowest product risk because billing, consent, rooms,
payments, and audit logs keep their existing tested data model.

## Fallback Option: Emergent-Native Rewrite

Use this only if custom Node/NestJS runtime is not supported.

Phase 1 maps the current system:

- Export Prisma models to a collection/index design.
- Preserve immutable ledgers for credits, payments, consent, audit, and usage.
- Define MongoDB transaction boundaries for subscription activation, manual
  payment approval, credit settlement, and room admission.

Phase 2 ports the API:

- Convert NestJS modules to FastAPI routers.
- Replace Prisma services with repository classes using MongoDB sessions.
- Replace `livekit-server-sdk` with the Python LiveKit server SDK.
- Replace AWS JS SDK storage signing with boto3-compatible signed URLs.
- Replace Vitest API tests with Pytest.

Phase 3 ports operations:

- Rebuild seed scripts.
- Rebuild provider encryption and fingerprints.
- Rebuild health checks and deployment status.
- Run side-by-side sandbox payment and LiveKit tests.

Phase 4 cuts over:

- Freeze writes.
- Migrate relational data into MongoDB.
- Reconcile credit/payment ledgers.
- Run acceptance tests.
- Switch DNS only after ledger parity is proven.

## Risk

Current-stack deployment risk is medium and mostly platform compatibility.
Emergent-native rewrite risk is high because the billing, credit, and consent
ledger semantics must be reimplemented.
