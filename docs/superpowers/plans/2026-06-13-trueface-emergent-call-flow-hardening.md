# TrueFace Emergent Call Flow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix host/guest room admission, strengthen LiveKit/system health, and update deployment readiness docs without rewriting the product.

**Architecture:** Keep the existing Next.js/NestJS/PostgreSQL stack. Add host-aware room URLs and admission state to the room API, fix participant approval with valid Prisma selectors, expose host controls in the call UI, add lifecycle timestamps/events, and document Emergent compatibility honestly.

**Tech Stack:** Next.js, React, NestJS, Prisma/PostgreSQL, LiveKit SDKs, Vitest, TypeScript.

---

### Task 1: Audit Docs

**Files:**

- Create: `docs/audit/EMERGENT_COMPATIBILITY_AUDIT.md`
- Create: `docs/audit/EMERGENT_MIGRATION_PLAN.md`
- Create: `docs/audit/FEATURE_PARITY_CHECKLIST.md`
- Create: `docs/audit/CURRENT_STACK_DEPENDENCIES.md`
- Create: `docs/audit/HOST_GUEST_CALL_BUG_ANALYSIS.md`
- Create: `docs/audit/DEPLOYMENT_OPTIONS.md`
- Create: `docs/audit/LAUNCH_BLOCKERS.md`
- Create: `docs/audit/EMERGENT_DEPLOYMENT_REPORT.md`
- Create: `docs/audit/FACE_AI_STATUS.md`
- Create: `docs/audit/GPU_FACE_REPLACEMENT_ARCHITECTURE.md`

- [x] Generate pre-code audit files from the actual repository.

### Task 2: Failing Room Service Tests

**Files:**

- Create: `apps/api/src/rooms/rooms.service.spec.ts`
- Modify: `apps/api/src/rooms/rooms.service.ts`

- [ ] Write a failing test proving a host gets a host URL, resolves as host, and receives a token without waiting-room approval.
- [ ] Write a failing test proving participant approval first verifies room ownership, then updates by unique participant ID.
- [ ] Run `npm test --workspace @trueface/api -- rooms.service.spec.ts` and confirm the tests fail for the expected reason.

### Task 3: Backend Room Fix

**Files:**

- Modify: `apps/api/src/rooms/rooms.service.ts`
- Modify: `apps/api/src/rooms/rooms.controller.ts`

- [ ] Return `hostUrl` from create and host room list responses.
- [ ] Include `isHost`, `inviteUrl`, and `hostUrl` in room resolution.
- [ ] Make host token generation set `startedAt`/`ACTIVE` when the call actually begins.
- [ ] Fix approval/rejection to verify `roomId` ownership before `update({ where: { id } })`.
- [ ] Add room events for join, approve, reject, start, and end.

### Task 4: Call Room UI Fix

**Files:**

- Modify: `apps/web/components/create-call-form.tsx`
- Modify: `apps/web/components/call-room-client.tsx`
- Modify: `apps/web/components/call-history-client.tsx`

- [ ] Open created rooms with `hostUrl`, not `inviteUrl`.
- [ ] Let authenticated hosts join immediately without guest-name gating.
- [ ] Show a host waiting panel with waiting participants and approve/reject buttons.
- [ ] Keep copy invite, participant status, and end room controls visible to host.

### Task 5: Health And Provider Visibility

**Files:**

- Modify: `apps/api/src/providers/providers.service.ts`
- Modify: `apps/api/src/admin/admin.service.ts`
- Modify: `apps/web/components/admin-overview.tsx`
- Modify: `apps/web/components/admin-deployment.tsx`

- [ ] Surface LiveKit configured/healthy state and last test status.
- [ ] Include room/token failure counters from `CallEvent` where available.
- [ ] Keep provider secrets masked and encrypted.

### Task 6: Verification

**Files:**

- Modify docs as needed after verification.

- [ ] Run `npm run db:generate`.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run start:deploy`.
- [ ] Browser-test host create, host room entry, guest waiting, host approval, and user dashboard.
- [ ] Update launch blockers and readiness score.
