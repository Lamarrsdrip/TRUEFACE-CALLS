# Emergent Migration Plan

## Status: Implemented

The migration is complete on `codex/emergent-native`.

- Next.js moved to `frontend/`.
- NestJS was replaced by FastAPI in `backend/`.
- PostgreSQL/Prisma were replaced by MongoDB collections and indexes.
- Private storage defaults to GridFS.
- Redis is not required.
- Backend routes use `/api` and port 8001.
- Provider secrets remain admin-configurable and encrypted.

The previous architecture remains preserved on `codex/trueface-foundation`.
