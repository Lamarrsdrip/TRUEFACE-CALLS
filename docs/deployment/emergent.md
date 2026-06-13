# Emergent Deployment Contract

The deployable branch is `codex/emergent-native`.

It uses the Emergent-supported layout and runtime:

- Standalone Next.js in `frontend/`.
- FastAPI in `backend/server.py`.
- Backend port `8001`.
- `/api` route prefix.
- MongoDB persistence.
- Private GridFS uploads.

Only seven bootstrap environment variables are required. All external
providers are configured later from the encrypted Admin Providers screen.

The operator-ready import instructions are in
[EMERGENT_DEPLOY.md](../../EMERGENT_DEPLOY.md).
