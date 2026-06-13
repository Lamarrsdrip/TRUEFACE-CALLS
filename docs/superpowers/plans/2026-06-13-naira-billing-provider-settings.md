# Naira Billing And Provider Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Naira-only billing, polished expiring manual bank-transfer sessions, and clear provider/email/storage administration.

**Architecture:** Keep FastAPI, MongoDB, GridFS, and the existing Next.js application. Add small backend domain helpers for currency, manual-payment transitions, provider completeness, and email delivery; keep route modules responsible for HTTP orchestration. Reuse the current design system while replacing generic provider fields with mode-aware forms.

**Tech Stack:** Python/FastAPI, MongoDB/mongomock, GridFS, SMTP/Resend, Next.js, React, TypeScript, Vitest.

---

### Task 1: Naira Domain Rules

**Files:**
- Create: `backend/app/billing_rules.py`
- Modify: `backend/app/seed.py`
- Modify: `backend/app/routers/billing.py`
- Modify: `backend/app/routers/admin.py`
- Modify: `frontend/lib/format.ts`
- Test: `backend/tests/test_billing_naira.py`
- Test: `frontend/lib/format.test.ts`

- [ ] Write failing tests proving plans and packs return `NGN`, Naira formatting
  uses `₦`, and admin plan writes cannot introduce another currency.
- [ ] Run the focused backend and frontend tests and confirm they fail because
  the code still defaults to USD.
- [ ] Add the `NGN` billing constant and Naira amount validation, migrate seed
  defaults, make seeding preserve administrator edits, and force all billing
  serializers to return NGN.
- [ ] Update frontend money formatting and cost assumptions to Naira.
- [ ] Run the focused tests and the existing billing tests until green.

### Task 2: Smart Manual Payment Sessions

**Files:**
- Create: `backend/app/manual_payments.py`
- Modify: `backend/app/routers/billing.py`
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/app/seed.py`
- Modify: `frontend/components/bank-transfer-checkout.tsx`
- Modify: `frontend/components/billing-client.tsx`
- Modify: `frontend/components/buy-credits-form.tsx`
- Modify: `frontend/components/admin-payments.tsx`
- Modify: `frontend/app/globals.css`
- Test: `backend/tests/test_manual_payment_sessions.py`

- [ ] Write failing tests for session creation, unique `TFC-` references,
  optional narration, exact Naira amount, lazy expiry, and admin approval after
  expiry.
- [ ] Run the focused test module and confirm the missing session behavior.
- [ ] Add payment reference generation, expiry transitions, session/read/submit
  endpoints, amount-limit enforcement, and idempotent approve/reject behavior.
- [ ] Rebuild the checkout UI around the created session, countdown, copyable
  bank details/reference, optional proof, and status polling.
- [ ] Update admin payment review with `APPROVED`, `REJECTED`, and `EXPIRED`
  states plus decision notes and audit details.
- [ ] Run focused and full backend/frontend tests.

### Task 3: Provider Completeness And Email Delivery

**Files:**
- Create: `backend/app/provider_policy.py`
- Create: `backend/app/email_service.py`
- Modify: `backend/app/routers/providers.py`
- Modify: `backend/app/routers/auth.py`
- Modify: `frontend/components/admin-providers.tsx`
- Modify: `frontend/lib/contracts.ts`
- Test: `backend/tests/test_provider_configuration.py`

- [ ] Write failing tests for configured/partial/unconfigured status, built-in
  GridFS status, Stripe absence, Gmail defaults, and safe email test behavior.
- [ ] Run the focused tests and confirm the current generic provider behavior
  fails them.
- [ ] Implement conditional provider requirements and separate configuration
  status from connection health.
- [ ] Remove Stripe checkout/webhook/provider code.
- [ ] Implement Gmail SMTP, custom SMTP, and Resend adapters; add a test-email
  endpoint and use the adapter for verification/reset delivery.
- [ ] Replace the provider UI with guided provider-specific forms, explanations,
  helper text, accurate badges, and readable test outcomes.
- [ ] Run focused and full tests.

### Task 4: Naira UI And Responsive Polish

**Files:**
- Modify: `frontend/components/admin-overview.tsx`
- Modify: `frontend/components/admin-plans.tsx`
- Modify: `frontend/components/admin-cost-calculator.tsx`
- Modify: `frontend/components/admin-deployment.tsx`
- Modify: `frontend/components/billing-client.tsx`
- Modify: `frontend/components/buy-credits-form.tsx`
- Modify: `frontend/app/pricing/page.tsx`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/privacy/page.tsx`
- Modify: provider and billing audit documentation under `docs/audit/`

- [ ] Replace all customer/admin monetary display with the centralized Naira
  formatter and remove Stripe from all visible choices and documentation.
- [ ] Add mobile provider navigation, grouped fields, helper text, and checkout
  layout rules without introducing a new design system.
- [ ] Update storage copy to identify GridFS as the launch default and
  Cloudflare R2 as an optional later migration.
- [ ] Run repository-wide searches for `USD`, `$`, and `stripe`, then remove
  remaining product references.
- [ ] Run backend tests, frontend tests, typecheck, build, compilation, and
  dependency audit.
- [ ] Start the preview and verify provider settings and bank checkout at
  desktop and phone widths using the in-app browser.
- [ ] Commit and push `codex/emergent-native`.
