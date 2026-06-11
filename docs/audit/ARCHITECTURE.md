# Architecture

TrueFace Calls is an npm-workspace monorepo.

- `apps/web`: Next.js 16 customer app, call UI, and separate admin console.
- `apps/api`: NestJS API, authentication, billing, metering, rooms, safety,
  provider adapters, and admin operations.
- `packages/database`: Prisma schema, PostgreSQL migrations, and idempotent
  bootstrap seed.
- `packages/contracts`: shared validation and policy types.
- `packages/media-engine`: browser face tracking/compositing abstraction.
- `packages/providers`: AES-256-GCM settings vault helpers.

The browser and API are exposed as one origin. Next.js rewrites `/api/*` to the
internal NestJS service. PostgreSQL is authoritative for subscriptions,
credits, consent, rooms, payments, moderation, and audit logs. Private images
use short-lived S3-compatible signed URLs.

Live video is published through LiveKit. Normal mode publishes the camera
track. AI mode unpublishes the raw track before publishing the processed
canvas track. The processing interface can later route frames to RunPod,
Modal, AWS GPU, or custom workers without changing billing or room contracts.
