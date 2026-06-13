# TrueFace Calls Emergent-Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a GitHub branch that Emergent can import directly as a standalone Next.js frontend plus FastAPI/MongoDB backend while preserving TrueFace product behavior.

**Architecture:** Move the existing browser application into `frontend/`, localize its two internal TypeScript dependencies, and proxy `/api` to FastAPI on port 8001. Implement MongoDB-backed FastAPI routers with encrypted provider settings, private GridFS storage, signed call invites, idempotent credit/payment ledgers, and startup seeding.

**Tech Stack:** Next.js 16, React 19, TypeScript, FastAPI, Pydantic, Motor/PyMongo, MongoDB GridFS, PyJWT, Argon2, AES-GCM, LiveKit Python SDK, Pytest.

---

### Task 1: Standalone Emergent Repository Layout

**Files:**
- Move: `apps/web/` to `frontend/`
- Create: `frontend/lib/contracts.ts`
- Create: `frontend/lib/media-engine.ts`
- Modify: `frontend/lib/browser-face-session.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/tsconfig.json`
- Modify: `frontend/next.config.ts`
- Create: `backend/requirements.txt`
- Create: `backend/server.py`
- Create: `backend/tests/test_health.py`

- [ ] Write a failing FastAPI health test expecting `/api/health`.
- [ ] Run `pytest backend/tests/test_health.py -q` and confirm import/route failure.
- [ ] Move the frontend, localize browser-only workspace packages, and add the FastAPI app shell.
- [ ] Run the health test and frontend typecheck.
- [ ] Commit the deployable directory skeleton.

### Task 2: MongoDB Configuration, Indexes, And Seed

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/database.py`
- Create: `backend/app/seed.py`
- Create: `backend/app/serializers.py`
- Create: `backend/tests/test_seed.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for deterministic plan seeding and UUID/date serialization.
- [ ] Run the tests and confirm missing implementations.
- [ ] Add environment validation, MongoDB lifecycle, required indexes, default plans, default cost settings, and bootstrap admin seeding.
- [ ] Run focused tests.
- [ ] Commit database foundations.

### Task 3: Authentication, Sessions, CSRF, And Admin Authorization

**Files:**
- Create: `backend/app/security.py`
- Create: `backend/app/dependencies.py`
- Create: `backend/app/routers/auth.py`
- Create: `backend/app/services/audit.py`
- Create: `backend/tests/test_auth.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for signup, login, cookie sessions, CSRF rejection, refresh rotation, admin login, and account deletion.
- [ ] Run tests and confirm missing route behavior.
- [ ] Implement Argon2 passwords, JWT cookies, hashed refresh sessions, CSRF, MongoDB rate limits, admin permissions, verification/reset tokens, export, and deletion scheduling.
- [ ] Run focused tests.
- [ ] Commit authentication.

### Task 4: Encrypted Provider Configuration And Health

**Files:**
- Create: `backend/app/services/vault.py`
- Create: `backend/app/services/providers.py`
- Create: `backend/app/routers/providers.py`
- Create: `backend/tests/test_vault.py`
- Create: `backend/tests/test_providers.py`
- Modify: `backend/server.py`

- [ ] Write failing tests proving AES-GCM round trips, secret masking, no plaintext persistence, and unconfigured/tested health states.
- [ ] Run tests and confirm failures.
- [ ] Implement provider definitions, encrypted MongoDB settings, fingerprints, audit records, provider test adapters, and health persistence.
- [ ] Run focused tests.
- [ ] Commit provider administration.

### Task 5: Subscription And Credit Ledger

**Files:**
- Create: `backend/app/services/entitlements.py`
- Create: `backend/app/services/credits.py`
- Create: `backend/app/routers/credits.py`
- Create: `backend/tests/test_credits.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for trial grants, included/purchased balances, paid-subscription top-up gating, idempotent reserve/settle/release, reset windows, and quality multipliers.
- [ ] Run tests and confirm missing ledger behavior.
- [ ] Implement atomic wallet updates, immutable transactions, usage windows, quotes, and entitlement checks.
- [ ] Run focused tests.
- [ ] Commit credit metering.

### Task 6: Billing, Gateway Adapters, And Manual Bank Transfers

**Files:**
- Create: `backend/app/services/billing.py`
- Create: `backend/app/routers/billing.py`
- Create: `backend/tests/test_billing.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for checkout gating, pending manual payments, admin-only approval, idempotent activation, webhook signature rejection, and credit/subscription fulfillment.
- [ ] Run tests and confirm failures.
- [ ] Implement plans/subscription/payment APIs, Stripe/Paystack/Flutterwave adapters, webhook idempotency, bank transfer configuration, proof storage references, and approval fulfillment.
- [ ] Run focused tests.
- [ ] Commit billing.

### Task 7: Persistent Rooms, Waiting Room, And LiveKit

**Files:**
- Create: `backend/app/services/invites.py`
- Create: `backend/app/services/rooms.py`
- Create: `backend/app/routers/rooms.py`
- Create: `backend/tests/test_rooms.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for expiring signed invites, distinct host/invite URLs, room persistence, waiting approval ownership, safe participant updates, lifecycle timestamps, and unavailable LiveKit errors.
- [ ] Run tests and confirm failures.
- [ ] Implement room CRUD, participants, host controls, history/events, password checks, LiveKit tokens, room termination, and user room listing.
- [ ] Run focused tests.
- [ ] Commit call management.

### Task 8: Face Profiles, Consent, Quality, And Private Storage

**Files:**
- Create: `backend/app/services/storage.py`
- Create: `backend/app/services/faces.py`
- Create: `backend/app/routers/faces.py`
- Create: `backend/tests/test_faces.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for profile/image limits, required consent, one-face quality signals, readiness scoring, private uploads/downloads, moderation, revocation, and deletion.
- [ ] Run tests and confirm failures.
- [ ] Implement GridFS storage routes plus optional S3/R2 adapters, multi-image profiles, consent logs, quality/readiness, activation, moderation state, and hard deletion.
- [ ] Run focused tests.
- [ ] Commit face data handling.

### Task 9: Safety, Notifications, And Admin Operations

**Files:**
- Create: `backend/app/routers/safety.py`
- Create: `backend/app/routers/notifications.py`
- Create: `backend/app/routers/admin.py`
- Create: `backend/tests/test_admin.py`
- Modify: `backend/server.py`

- [ ] Write failing tests for blocking, abuse reporting, moderation, manual payment decisions, credit adjustments, plan edits, broadcasts, audit export, and deployment status.
- [ ] Run tests and confirm failures.
- [ ] Implement remaining user/admin route parity and cost/profitability settings.
- [ ] Run focused tests.
- [ ] Commit operations console support.

### Task 10: Emergent Documentation And Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Create: `EMERGENT_DEPLOY.md`
- Create: `backend/.env.example`
- Create: `frontend/.env.example`
- Modify: `docs/audit/EMERGENT_DEPLOYMENT_REPORT.md`
- Modify: `docs/audit/PRODUCTION_READINESS.md`

- [ ] Document exact Emergent import, frontend/backend commands, environment variables, admin bootstrap, provider setup, and external keys.
- [ ] Run `pytest backend/tests -q`.
- [ ] Run `npm install`, frontend tests, typecheck, and production build from `frontend/`.
- [ ] Start FastAPI on port 8001 and Next.js on port 3000; verify health, user login, admin login, provider configuration, room creation, and manual payment flow.
- [ ] Scan for hardcoded secrets and plaintext provider credentials.
- [ ] Commit, push `codex/emergent-native`, and report the commit hash and import instructions.
