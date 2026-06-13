# Current Stack Dependencies

## Runtime

- Node.js 22+.
- npm 10+ workspaces.
- Next.js 16 web/admin app.
- NestJS 11 API.
- Prisma 6 client and migrations.
- PostgreSQL 16+.
- Redis URL for deployment compatibility and future jobs.
- S3-compatible private object storage.

## Video And Media

- LiveKit Cloud or compatible LiveKit server.
- `livekit-client` and `@livekit/components-react` in the browser.
- `livekit-server-sdk` in the API.
- MediaPipe Tasks Vision.
- Browser WebGL, Canvas, and optional WebCodecs support.

## Payments And Providers

- Stripe.
- Paystack.
- Flutterwave.
- Manual bank transfer.
- Resend-compatible transactional email.
- Sentry optional.
- Future GPU providers: RunPod, Modal, AWS GPU, Lambda Labs, Replicate, and
  custom endpoints.

## Deployment Commands

Build:

```bash
npm ci && npm run db:generate && npm run build
```

Start:

```bash
npm run start:deploy
```

`start:deploy` applies committed migrations, runs the idempotent seed, and
starts the API plus web processes.
