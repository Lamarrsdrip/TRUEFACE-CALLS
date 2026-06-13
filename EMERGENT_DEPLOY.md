# Deploy TrueFace Calls On Emergent

## Pull From GitHub

- Repository: `https://github.com/Lamarrsdrip/TRUEFACE-CALLS`
- Branch: `codex/emergent-native`

This branch already matches Emergent's required architecture. Do not regenerate
the application or convert frameworks during import.

## Detection Contract

- Frontend directory: `frontend`
- Backend directory: `backend`
- FastAPI entrypoint: `backend/server.py`
- Exported application: `app`
- Backend port: `8001`
- API prefix: `/api`
- Database: Emergent-managed MongoDB
- Private file storage: MongoDB GridFS

Emergent's normal supervisor commands are sufficient. If it requests explicit
commands:

```text
Frontend install: npm install
Frontend build: npm run build
Frontend start: npm start
Backend install: pip install -r requirements.txt
Backend start: uvicorn server:app --host 0.0.0.0 --port 8001
```

Run frontend commands inside `frontend/` and backend commands inside
`backend/`.

## Environment

Set:

```text
MONGO_URL=<Emergent MongoDB connection URL>
DB_NAME=trueface
APP_URL=<Emergent public HTTPS URL>
AUTH_SECRET=<unique random value of at least 32 characters>
SETTINGS_MASTER_KEY=<base64 of exactly 32 random bytes>
BOOTSTRAP_ADMIN_EMAIL=<owner administrator email>
BOOTSTRAP_ADMIN_PASSWORD=<new strong unique password>
```

Do not add LiveKit, payment, email, storage or GPU secrets to frontend
variables. Enter them after deployment through `/admin/providers`.

## Acceptance

Verify:

1. `/api/health` returns `status: ok` and `database: connected`.
2. `/signup` creates a trial account.
3. `/login` and `/admin/login` work.
4. `/admin/providers` saves secrets as fingerprints and tests providers.
5. `/admin/plans` loads all four seeded plans.
6. `/create-call` creates a persistent room and distinct invite/host links.
7. `/faces/upload` performs quality and consent checks.
8. Manual bank payments remain pending until administrator approval.
9. `/admin/system-health` identifies unconfigured external providers.

## External Accounts Needed Later

- LiveKit Cloud or a compatible LiveKit server.
- Stripe, Paystack and/or Flutterwave.
- Transactional email or SMTP.
- Optional S3/R2 storage if moving away from GridFS.
- Optional RunPod, Modal, AWS, Replicate or custom GPU workers.

The application must show `UNCONFIGURED` until a provider passes a real
connection test. It must never simulate successful payments, calls or email.
