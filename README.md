# TrueFace Calls

Consent-first, mobile-first face processing for browser video calls.

This branch is the **Emergent-native** edition:

```text
frontend/   Next.js, React, TypeScript, LiveKit client, MediaPipe and WebGL
backend/    FastAPI on port 8001, MongoDB and private GridFS storage
runpod-worker/  GPU face-replacement worker, Dockerfile and model setup
docs/       Architecture, security, audit and provider documentation
```

The original NestJS/PostgreSQL edition remains preserved on
`archive/trueface-foundation-nestjs`.

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

The frontend uses same-origin `/api` calls. GridFS storage, the local enhanced
face mask and browser voice tones need no external key. Real calls require
LiveKit; email and automated gateways need their own accounts. The local mask
is real processed-track compositing, but it is not a photorealistic neural face
swap. That requires a separate realtime GPU/video worker.

## Realtime Media Status

- **Local enhanced face mask:** implemented with MediaPipe, smoothed face-oval
  compositing, adaptive lighting, feathered edges and safe raw-camera restore.
  It is the default and works without RunPod, Modal, Replicate, or any cloud
  GPU key. Runtime fallback is browser GPU acceleration -> CPU/Canvas 2D ->
  restored raw camera with a visible warning.
- **Browser voice tone:** implemented with Web Audio/AudioWorklet and processed
  LiveKit microphone publication. It is a modest tone effect, not cloning.
- **Cloud AI face swap:** the backend frame gateway, browser processed-track
  client and versioned RunPod worker are implemented. The worker uses
  InsightFace-style detection/recognition, multi-reference identity averaging,
  GPU swap inference, color matching, detail sharpening, optional GFPGAN
  restoration and temporal smoothing. Final photorealism still depends on the
  deployed model quality and must be proven with RunPod visual tests.
- **Emergent LLM:** optional metadata-only quality guidance, provider fallback
  recommendations, and admin diagnostics. Live camera frames are not sent to
  the LLM.
- **Device guidance:** pricing and billing pages include phone recommendations
  and an optional advisory capability check.

## AI Provider Environment Fallbacks

```bash
EMERGENT_LLM_API_KEY=
EMERGENT_LLM_BASE_URL=
AI_FACE_PROVIDER=local
GPU_PROVIDER=
GPU_INFERENCE_URL=
GPU_INFERENCE_API_KEY=
```

`AI_FACE_PROVIDER=local` is the production default. Admin values saved under
`/admin/providers` are encrypted and override these environment fields.
`GPU_INFERENCE_URL` must implement the normalized contract documented in
`docs/audit/GPU_FACE_REPLACEMENT_ARCHITECTURE.md`.

The versioned worker contract and RunPod deploy notes are in
`runpod-worker/README.md`.
