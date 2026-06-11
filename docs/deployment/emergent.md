# Emergent Deployment Contract

This repository targets Emergent for preview, build, hosting, SSL, deployment, and production secret management while keeping infrastructure adapters portable.

## Platform Fit

Emergent documentation confirms:

- GitHub repositories can be pulled into an Emergent workspace.
- Preview links support end-to-end testing and hot updates.
- First deployment creates a permanent application URL and production secrets.
- Redeploy updates code while preserving the production data service and existing secrets.
- Existing production secrets must be changed in Emergent's deployment settings; changing `.env` alone does not overwrite them.

Emergent currently documents MongoDB as its native production database. This application requires PostgreSQL and Prisma, so production uses an external managed PostgreSQL URL.

## Import and Deploy

1. Connect GitHub from the Emergent profile menu.
2. Start a new task and choose **Pull from GitHub**.
3. Select `Lamarrsdrip/TRUEFACE-CALLS` and branch
   `codex/trueface-foundation`.
4. Add required production environment variables in deployment settings.
5. Run the preview and complete the health-check checklist.
6. Use **Deploy** for the first production release.
7. Use **Redeploy** for normal code updates.
8. Update existing secret values in deployment settings before redeploying.

## Commands

Build:

```bash
npm ci && npm run db:generate && npm run build
```

Start:

```bash
npm run start:deploy
```

## Required Bootstrap Variables

- `NODE_ENV`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `APP_URL`
- `API_URL`
- `API_INTERNAL_URL` (normally `http://127.0.0.1:4000`)
- `API_PORT` (normally `4000`)
- `AUTH_SECRET`
- `SETTINGS_MASTER_KEY`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Provider credentials are preferably entered after deployment through the admin dashboard. The bootstrap variables are required because the database, session security, and encrypted settings vault must exist before the dashboard can load.

## Admin Setup

1. Open `https://YOUR-EMERGENT-URL/admin/login`.
2. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and
   `BOOTSTRAP_ADMIN_PASSWORD`.
3. Open **Providers** and configure LiveKit, storage, email, and one payment
   method.
4. Test each configured provider.
5. Open **Plans & limits** for subscription entitlements.
6. Open **Billing** for credit packs, provider-cost assumptions, and margin
   estimates.
7. Open **App settings** for branding, safety rules, and feature flags.
8. Rotate the bootstrap password after the first production login.

Admin-saved provider credentials are encrypted with `SETTINGS_MASTER_KEY`.
Changing that key without a credential migration makes existing encrypted
settings unreadable.

## External Provider Keys

- LiveKit URL, API key, and API secret.
- S3-compatible endpoint, region, bucket, access key, and secret.
- Stripe secret and webhook secret.
- Paystack secret and webhook secret.
- Flutterwave secret, encryption key, and webhook hash.
- Resend or Postmark API key and sender identity.
- Sentry DSN.
- Optional RunPod, Modal, AWS, Replicate, or custom GPU credentials.
