# Emergent Deployment Report

## Status

The application has been migrated to Emergent's supported architecture.

- Frontend: `frontend/`
- Backend: `backend/server.py`
- Backend port: `8001`
- API prefix: `/api`
- Database: MongoDB
- Storage: private GridFS

## Import

Pull `Lamarrsdrip/TRUEFACE-CALLS`, branch `codex/emergent-native`.

## Required Environment

- `MONGO_URL`
- `DB_NAME`
- `APP_URL`
- `AUTH_SECRET`
- `SETTINGS_MASTER_KEY`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

All other provider credentials can be saved later in the encrypted admin
dashboard.

## Remaining Acceptance

Emergent must supply a production URL and MongoDB connection. Real LiveKit,
payment, email and GPU acceptance testing requires credentials from those
external providers.
