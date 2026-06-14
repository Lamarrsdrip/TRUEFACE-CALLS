# TrueFace Calls Audit Handoff

Audit target: `codex/emergent-native`.

The deployed runtime is `frontend/` plus `backend/`. The dormant local
`apps/` and `packages/` build artifacts are not tracked and are not part of
the Emergent deployment.

Implemented and tested:

- FastAPI, MongoDB and private GridFS on Emergent's native layout.
- Secure cookie authentication, CSRF, Argon2 passwords and session revocation.
- Naira-only plans, manual bank checkout, optional Paystack/Flutterwave, and
  idempotent payment fulfillment.
- Included/purchased credit balances and server-calculated usage rates.
- Persistent signed call rooms with waiting-room and guest flows.
- Multi-image consent-backed face profiles with private one-time uploads.
- Encrypted provider settings, readiness checks and admin audit logs.

Final verification on June 14, 2026:

- `50` backend tests passed.
- `7` frontend tests passed.
- TypeScript typecheck passed.
- Next.js production build generated all `47` routes.
- Frontend production dependency audit reported `0` vulnerabilities.
- Local production smoke test passed signup, authenticated session, trial
  subscription, wallet, room listing, readiness and same-origin API proxying.
- Unconfigured call creation returned coded
  `LIVEKIT_NOT_CONFIGURED`/HTTP 503 with a request ID instead of a generic 500.

Important limits:

- LiveKit credentials are required before any real call can start.
- Browser AI is currently a tracked 2D face compositor, not a photorealistic
  generative face-swap model.
- Administrator TOTP MFA and server-authoritative AI runtime telemetry remain
  pre-public-launch work.

Verification commands:

```bash
python3 -m pip install -r backend/requirements-dev.txt
python3 -m pytest backend/tests -q
cd frontend
npm ci
npm test
npm run typecheck
npm run build
```

See `PRODUCTION_READINESS.md`, `KNOWN_LIMITATIONS.md`, and the generated
`SECURITY_SCAN_REPORT.html` before public launch.
