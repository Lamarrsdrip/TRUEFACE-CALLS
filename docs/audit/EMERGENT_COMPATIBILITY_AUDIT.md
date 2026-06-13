# Emergent Compatibility Audit

## Result

`codex/emergent-native` now matches the platform limitations reported by
Emergent:

- Next.js lives in `frontend/`.
- Python/FastAPI lives in `backend/`.
- FastAPI uses port 8001.
- Routes use `/api`.
- Persistence uses MongoDB.
- Private files use GridFS.
- No custom root build/start pipeline is required.

The earlier Node/PostgreSQL architecture remains available only on
`codex/trueface-foundation`.
