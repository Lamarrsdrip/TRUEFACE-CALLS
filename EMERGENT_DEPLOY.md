# Deploy TrueFace Calls On Emergent

## Import

- Repository: `https://github.com/Lamarrsdrip/TRUEFACE-CALLS`
- Branch: `codex/emergent-native`
- Replace the current scaffold with the branch contents.
- Keep the existing `frontend/` Next.js and `backend/` FastAPI folders.
- Do not rewrite frameworks.

## Runtime Contract

- Frontend: `frontend`, port 3000
- Backend: `backend/server.py`, exported app `app`, port 8001
- API ingress: same-origin `/api`
- Database: existing Emergent `MONGO_URL`, `DB_NAME=trueface`
- Private files: MongoDB GridFS

Commands, when Emergent asks for them:

```text
Frontend install: npm ci
Frontend build: npm run build
Frontend start: npm start
Backend install: pip install -r requirements.txt
Backend start: uvicorn server:app --host 0.0.0.0 --port 8001
```

Run frontend commands in `frontend/` and backend commands in `backend/`.

## Required Environment

```text
MONGO_URL=<existing Emergent MongoDB URL>
DB_NAME=trueface
APP_URL=<public Emergent HTTPS URL>
API_INTERNAL_URL=http://127.0.0.1:8001
AUTH_SECRET=<unique random 32+ character value>
SETTINGS_MASTER_KEY=<base64 of exactly 32 random bytes>
BOOTSTRAP_ADMIN_EMAIL=<owner email>
BOOTSTRAP_ADMIN_PASSWORD=<strong temporary password>
```

Production startup intentionally fails when auth/vault secrets are missing or
still use development defaults.

## After Preview Starts

1. Open `/api/health`.
2. Sign in at `/admin/login`.
3. Configure LiveKit in `/admin/providers`.
4. Configure Manual Bank with bank name, account name and account number.
5. Configure Gmail SMTP, custom SMTP or Resend.
6. Optionally configure Paystack, Flutterwave, Emergent AI, GPU, monitoring or
   WhatsApp.
7. Configure plans and usage rates in the admin billing pages.
8. Open `/system-check` and confirm call creation is ready.

## What Emergent Handles

- source import, preview and production hosting
- frontend/backend process supervision
- managed MongoDB
- GridFS-backed private files for initial launch
- HTTPS, environment values and platform logs

## External Accounts

LiveKit is required for calls. Email is required for real verification and
password reset. Paystack/Flutterwave are optional because reviewed manual bank
payments work without them. Cloud AI/GPU is optional and not wired into the
current browser media path.

Do not report a provider as working until its real connection test passes.
