# TrueFace Calls Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Emergent-importable, provider-agnostic production foundation for a consent-first AI face-replacement video calling SaaS.

**Architecture:** A TypeScript npm-workspaces monorepo contains a Next.js web/admin app, NestJS API, Prisma/PostgreSQL data layer, shared contracts, provider adapters, and a browser media engine. Real external integrations are activated through encrypted admin configuration; unavailable providers produce explicit setup states.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, NestJS, Prisma, PostgreSQL, Redis-compatible queues, LiveKit, MediaPipe Tasks Vision, WebGL/Canvas, Zod, Vitest/Jest, Playwright, Stripe, Paystack, Flutterwave, S3-compatible storage.

---

### Task 1: Repository and Toolchain

**Files:**

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `.github/workflows/ci.yml`

- [ ] Define npm workspaces and root build/test/lint/typecheck/database scripts.
- [ ] Pin the supported Node and npm engines.
- [ ] Add local PostgreSQL, Redis, and MinIO services.
- [ ] Add CI jobs for install, Prisma validation, typecheck, tests, and builds.
- [ ] Verify a clean install resolves all workspace packages.

### Task 2: Shared Contracts and Database

**Files:**

- Create: `packages/contracts/src/*`
- Create: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/seed.ts`
- Create: `packages/database/src/client.ts`
- Test: `packages/contracts/src/*.test.ts`

- [ ] Write failing tests for plan entitlements, credit rates, consent versions, and room roles.
- [ ] Implement typed enums, schemas, and policy helpers.
- [ ] Define every required data model, index, relation, and immutable ledger constraint.
- [ ] Generate Prisma client and validate the schema.
- [ ] Seed default plans, public app settings, and a development admin.

### Task 3: API Platform and Security

**Files:**

- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/common/*`
- Create: `apps/api/src/auth/*`
- Create: `apps/api/src/config/*`
- Test: `apps/api/test/auth.e2e-spec.ts`

- [ ] Write failing auth and authorization integration tests.
- [ ] Implement validated runtime configuration and health checks.
- [ ] Implement password auth, verification, reset, rotating sessions, cookies, CSRF, CORS, Helmet, and throttling.
- [ ] Implement RBAC guards and audit interceptors.
- [ ] Verify auth tests and API build.

### Task 4: Encrypted Provider Settings

**Files:**

- Create: `apps/api/src/providers/*`
- Create: `packages/providers/src/*`
- Test: `apps/api/src/providers/*.spec.ts`

- [ ] Write failing tests for envelope encryption, secret redaction, provider precedence, and test-connection responses.
- [ ] Implement AES-256-GCM encrypted database settings using a deployment master key.
- [ ] Implement adapters for LiveKit, storage, email, Stripe, Paystack, Flutterwave, Redis, and future GPU providers.
- [ ] Add admin-only provider read/write/test routes and audit events.
- [ ] Ensure secrets are never returned after storage.

### Task 5: Credits, Plans, and Billing

**Files:**

- Create: `apps/api/src/credits/*`
- Create: `apps/api/src/billing/*`
- Test: `apps/api/src/credits/*.spec.ts`
- Test: `apps/api/test/billing.e2e-spec.ts`

- [ ] Write failing tests for wallet reservations, metering, insufficient balance, idempotent webhook settlement, refunds, and admin adjustments.
- [ ] Implement transactional wallet and immutable credit ledger services.
- [ ] Implement plan entitlement service and trial grants.
- [ ] Implement checkout session creation and verified provider webhooks.
- [ ] Add billing history and admin adjustment routes.

### Task 6: Rooms, LiveKit, and Call Metering

**Files:**

- Create: `apps/api/src/rooms/*`
- Create: `apps/api/src/calls/*`
- Test: `apps/api/test/rooms.e2e-spec.ts`

- [ ] Write failing tests for invite expiry, passwords, waiting room approval, guest policy, host permissions, and metering grace windows.
- [ ] Implement signed invite creation and validation.
- [ ] Implement room lifecycle and participant authorization.
- [ ] Implement scoped LiveKit token issuing and webhook handling.
- [ ] Implement metering start/heartbeat/stop with wallet reservations.

### Task 7: Face Profiles, Consent, and Moderation

**Files:**

- Create: `apps/api/src/faces/*`
- Create: `apps/api/src/moderation/*`
- Test: `apps/api/test/faces.e2e-spec.ts`

- [ ] Write failing tests proving profiles cannot be created without all attestations.
- [ ] Implement signed private uploads and image metadata validation.
- [ ] Implement quality checks, consent records, moderation states, limits, and deletion jobs.
- [ ] Implement abuse reports, blocking, and moderation admin routes.
- [ ] Verify deletion removes object references and revokes consent.

### Task 8: Browser Media Engine

**Files:**

- Create: `packages/media-engine/src/*`
- Test: `packages/media-engine/src/*.test.ts`

- [ ] Write failing tests for capability selection, tracking confidence, adaptive quality, publication ordering, and raw-track exclusion.
- [ ] Implement capability evaluator and quality profiles.
- [ ] Implement MediaPipe worker contract and tracking state machine.
- [ ] Implement WebGL/Canvas compositor with a privacy-safe aligned texture overlay.
- [ ] Implement processed track creation and LiveKit publisher adapter.
- [ ] Implement visible AI state metadata and tracking-loss pause behavior.

### Task 9: Web Design System and Marketing/Auth

**Files:**

- Create: `apps/web/app/globals.css`
- Create: `packages/ui/src/*`
- Create: `apps/web/app/(marketing)/*`
- Create: `apps/web/app/(auth)/*`
- Test: `apps/web/tests/*`

- [ ] Build tokens and accessible primitives from the approved concept boards.
- [ ] Implement landing, pricing, privacy, terms, help, login, signup, verification, and reset pages.
- [ ] Connect real forms to the API with provider/setup error states.
- [ ] Verify desktop and mobile screenshots against the approved concepts.

### Task 10: User Application

**Files:**

- Create: `apps/web/app/(app)/*`
- Create: `apps/web/features/dashboard/*`
- Create: `apps/web/features/faces/*`
- Create: `apps/web/features/billing/*`

- [ ] Implement dashboard, create-call, face library/upload, subscription, credits, billing, history, settings, privacy, reports, and support.
- [ ] Connect wallet, plans, profile limits, call history, and purchases to real API data.
- [ ] Implement face crop/quality/consent flow with deletion controls.
- [ ] Verify no inert controls or fabricated successful transactions remain.

### Task 11: Call Room

**Files:**

- Create: `apps/web/app/call/[slug]/*`
- Create: `apps/web/features/call/*`
- Test: `apps/web/tests/call-room.spec.ts`

- [ ] Implement secure link resolution and guest/logged-in preflight.
- [ ] Implement waiting room, LiveKit connection, participants, chat, screen share, host controls, reconnect, and network status.
- [ ] Implement AI profile selection and processed track toggle.
- [ ] Display remaining credits, rate estimate, and persistent AI disclosure.
- [ ] Verify raw and processed publication ordering with the fake adapter and real provider when configured.

### Task 12: Admin Dashboard

**Files:**

- Create: `apps/web/app/admin/*`
- Create: `apps/web/features/admin/*`
- Test: `apps/web/tests/admin.spec.ts`

- [ ] Implement overview, users, subscriptions, payments, credits, calls, AI usage, moderation, reports, provider health, notifications, plans, branding, and audit screens.
- [ ] Implement encrypted provider configuration forms with write-only secrets.
- [ ] Implement admin re-authentication gates for secrets and manual credits.
- [ ] Verify role restrictions and audit records.

### Task 13: Documentation and Operations

**Files:**

- Create: `README.md`
- Create: `docs/deployment/emergent.md`
- Create: `docs/operations/runbook.md`
- Create: `docs/security/launch-checklist.md`

- [ ] Document local setup, environment variables, build/start/migrate commands, and provider setup.
- [ ] Document Emergent GitHub import, preview, production secret entry, first deploy, and redeploy.
- [ ] Document backups, secret rotation, webhook recovery, moderation, and incident response.
- [ ] Confirm no secret values or test production credentials are committed.

### Task 14: Final Verification and Publication

- [ ] Run Prisma format, validate, generate, and migration checks.
- [ ] Run all unit and integration tests.
- [ ] Run lint and typecheck for all workspaces.
- [ ] Build web and API production bundles.
- [ ] Start the production processes and run smoke checks.
- [ ] Run browser QA at desktop, iPhone, and Android viewports.
- [ ] Compare implementation screenshots to both approved concept boards.
- [ ] Audit every requested page and release criterion.
- [ ] Initialize Git, commit the complete repository, create a GitHub repository, and push when account authentication is available.
