# Deployment Options

## Recommended

Pull `codex/emergent-native` directly into Emergent. It requires no external
application host, PostgreSQL, Redis, S3 bucket, VPS, Nginx or custom Docker
runtime.

## Fallback

The original Node/PostgreSQL implementation remains on
`codex/trueface-foundation` for Railway, Render or another custom-runtime
platform.

External LiveKit, payment, email and GPU services remain provider accounts,
not application hosting dependencies.
