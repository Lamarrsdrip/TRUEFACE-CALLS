# Deployment Options

## Option A: Emergent Custom Runtime With External Services

Recommended if Emergent accepts the current repository commands.

- Keeps the SaaS product intact.
- Uses external PostgreSQL, Redis, S3, LiveKit, email, and payments.
- Lowest engineering risk.
- Requires confirming port/process support for Next.js and NestJS.

## Option B: Emergent Runs Frontend, API Hosted Elsewhere

Acceptable fallback if Emergent can host Next.js but not the NestJS API.

- Emergent hosts web/admin.
- API runs on Render, Railway, Fly, AWS, or another managed Node host.
- Requires `API_INTERNAL_URL`/rewrites or public API URL changes.
- Adds cross-platform operations but avoids a rewrite.

## Option C: Emergent-Native FastAPI/MongoDB Rewrite

Use only when required by platform constraints.

- Highest engineering risk.
- Requires rebuilding data model, transactional ledgers, provider adapters,
  tests, and migration tooling.
- Best performed after the current stack is stable and fully specified.

## Recommendation

Attempt Option A first. Option B is the practical fallback. Option C is a
strategic migration, not a quick launch path.
