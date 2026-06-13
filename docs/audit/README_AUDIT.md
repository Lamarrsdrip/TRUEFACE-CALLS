# TrueFace Calls Audit Handoff

This audit describes `codex/emergent-native`.

## Runtime

- `frontend/`: standalone Next.js mobile-first customer and admin UI.
- `backend/`: FastAPI on port 8001.
- MongoDB collections and private GridFS file storage.
- Same-origin `/api` ingress.

## Implemented

- Cookie authentication, CSRF, Argon2 passwords and refresh sessions.
- Subscription-first credit top-ups and milli-credit usage ledger.
- Trial, Basic, Pro and Business plan controls.
- Manual bank transfers with administrator-only approval.
- Stripe, Paystack and Flutterwave checkout adapters and webhook verification.
- Persistent call rooms, signed invites, waiting room and host controls.
- LiveKit token adapter with explicit unconfigured state.
- Multi-image face profiles, quality/readiness and immutable consent logs.
- Private signed face downloads, moderation, deletion and abuse reporting.
- Encrypted admin provider settings and connection health.
- Admin users, credits, plans, payments, calls, moderation, settings,
  broadcasts and audit export.

## Verification

Run:

```bash
python3 -m pytest backend/tests -q
cd frontend
npm ci
npm test
npm run typecheck
npm run build
```

Deployment instructions are in `EMERGENT_DEPLOY.md`.

External services remain unavailable until their keys are entered through
`/admin/providers`. The application reports `UNCONFIGURED`; it does not fake
provider success.
