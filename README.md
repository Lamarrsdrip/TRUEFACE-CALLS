# TrueFace Calls

Consent-first, mobile-first face processing for browser video calls.

This branch is the **Emergent-native** edition:

```text
frontend/   Next.js, React, TypeScript, LiveKit client, MediaPipe and WebGL
backend/    FastAPI on port 8001, MongoDB and private GridFS storage
docs/       Architecture, security, audit and provider documentation
```

The original NestJS/PostgreSQL edition remains preserved on
`codex/trueface-foundation`.

## Emergent Import

Import:

```text
https://github.com/Lamarrsdrip/TRUEFACE-CALLS
```

Select branch:

```text
codex/emergent-native
```

Emergent should detect `frontend/` and `backend/`. The backend entrypoint is
`backend/server.py`, exports `app`, and listens through Emergent's required
FastAPI port `8001`. Every backend route starts with `/api`.

See [EMERGENT_DEPLOY.md](EMERGENT_DEPLOY.md) for the exact deployment prompt.

## Required Environment

```text
MONGO_URL
DB_NAME
APP_URL
AUTH_SECRET
SETTINGS_MASTER_KEY
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

Generate `SETTINGS_MASTER_KEY` as base64 for exactly 32 random bytes. Provider
keys are intentionally absent from the required environment.

## Admin Provider Setup

After deployment:

1. Open `/admin/login`.
2. Sign in with the bootstrap administrator.
3. Open `/admin/providers`.
4. Configure LiveKit first, then manual bank, email and optional providers.
5. Configure manual bank details if accepting reviewed transfers.
6. Open `/admin/plans` to configure subscription prices, credits and limits.
7. Open `/admin/settings` for branding, safety and product-policy JSON.
8. Open `/system-check` to verify database, LiveKit, storage, AI and email.

Provider credentials are encrypted with AES-256-GCM before MongoDB storage.
The browser receives only fingerprints, never saved secret values.

## Local Verification

Backend:

```bash
python3 -m pip install -r backend/requirements-dev.txt
python3 -m pytest backend/tests -q
cd backend
uvicorn server:app --host 0.0.0.0 --port 8001
```

Frontend:

```bash
cd frontend
npm ci
npm test
npm run typecheck
npm run build
npm start
```

The frontend uses same-origin `/api` calls. GridFS storage and browser AI need
no external key. Real calls require LiveKit; email and automated gateways need
their own accounts. The current browser AI is a tracked compositor, not yet a
photorealistic generative replacement model.
