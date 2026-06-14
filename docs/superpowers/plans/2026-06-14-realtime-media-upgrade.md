# TrueFace Realtime Media Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship truthful local face processing, real browser voice-tone processing, persisted preferences, device guidance, and enforceable admin controls.

**Architecture:** Keep browser media processors independent from LiveKit publication. A small track-replacement helper owns publish/restore behavior; backend profile and entitlement endpoints remain authoritative.

**Tech Stack:** FastAPI, MongoDB, Next.js, React, TypeScript, LiveKit, MediaPipe, Canvas, Web Audio AudioWorklet, Vitest, Pytest.

---

### Task 1: Profile Preferences And Feature Restrictions

**Files:**
- Modify: `backend/app/routers/auth.py`
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/app/routers/credits.py`
- Modify: `frontend/components/settings-client.tsx`
- Modify: `frontend/components/admin-users.tsx`
- Test: `backend/tests/test_profile_preferences.py`

- [ ] Write failing tests for valid and invalid profile preferences.
- [ ] Write failing tests for admin face/voice restrictions and metering denial.
- [ ] Add defaults, profile update API, computed face readiness, and audit logs.
- [ ] Add mobile profile fields and admin restriction controls.
- [ ] Run focused backend and frontend tests.

### Task 2: Processed LiveKit Track Safety

**Files:**
- Create: `frontend/lib/livekit-processing.ts`
- Test: `frontend/lib/livekit-processing.test.ts`
- Modify: `frontend/components/call-room-client.tsx`

- [ ] Write failing tests for processed-track publication.
- [ ] Write failing tests proving original-track restoration after failure.
- [ ] Implement a source-agnostic replacement session helper.
- [ ] Route face and voice publication through the helper.
- [ ] Run the focused tests.

### Task 3: Local Enhanced Face Mask

**Files:**
- Modify: `frontend/lib/browser-face-session.ts`
- Create: `frontend/lib/processing-status.ts`
- Test: `frontend/lib/processing-status.test.ts`
- Modify: `frontend/components/call-room-client.tsx`

- [ ] Write failing tests for truthful local/cloud/unavailable labels.
- [ ] Add smoothed geometry, face-oval clipping, feathered compositing, adaptive
  lighting, blink/mouth-driven local deformation, and frame-pressure fallback.
- [ ] Replace misleading AI-swap copy with the active processing label.
- [ ] Verify local processing failure leaves the raw camera published.

### Task 4: Browser Voice Tone

**Files:**
- Create: `frontend/public/audio/voice-tone-processor.js`
- Create: `frontend/lib/browser-voice-session.ts`
- Test: `frontend/lib/browser-voice-session.test.ts`
- Modify: `frontend/components/call-room-client.tsx`

- [ ] Write failing support/preference tests.
- [ ] Implement AudioWorklet pitch/tone processing and MediaStream destination.
- [ ] Add call controls, warnings, processed-audio publication, and restoration.
- [ ] Keep cloud voice conversion unavailable until a real provider is set.

### Task 5: Device Guidance

**Files:**
- Create: `frontend/lib/device-capabilities.ts`
- Test: `frontend/lib/device-capabilities.test.ts`
- Create: `frontend/components/device-compatibility.tsx`
- Modify: `frontend/app/pricing/page.tsx`
- Modify: `frontend/components/billing-client.tsx`
- Modify: `frontend/app/globals.css`

- [ ] Write failing tests for Excellent/Good/Fair/Not recommended ratings.
- [ ] Implement advisory browser/device/FPS/camera checks.
- [ ] Add the requested Basic, Standard, and Pro phone recommendations.
- [ ] Add battery, thermal-proxy, visibility, and unsupported-feature warnings.

### Task 6: Billing And Documentation

**Files:**
- Modify: `backend/app/seed.py`
- Modify: `backend/app/payment_fulfillment.py`
- Modify: `backend/app/routers/admin.py`
- Modify: `frontend/components/admin-plans.tsx`
- Modify: `README_AUDIT.md` and audit documents

- [ ] Test subscription duration separately from credit reset.
- [ ] Add duration control to plans and fulfillment.
- [ ] Update documentation with exact real, limited, and provider-dependent behavior.
- [ ] Run all backend/frontend verification and browser smoke checks.
- [ ] Commit, push `codex/emergent-native`, and create the audit zip.
