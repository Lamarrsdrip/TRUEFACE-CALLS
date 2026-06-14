# Production Readiness

## Verified Foundation

- Emergent-native Next.js/FastAPI/MongoDB layout.
- Idempotent startup indexes and seed data.
- Auth, Naira billing, manual payment, room, face-consent and admin APIs.
- Encrypted provider settings and readiness diagnostics.
- Automated backend tests plus frontend test, type and production-build gates.

## Final Verification

Verified on June 14, 2026:

- Backend: `54 passed`.
- Frontend: `16 passed`.
- TypeScript: passed.
- Production build: passed; `47` routes generated.
- Frontend production dependencies: `0` known vulnerabilities.
- Python compilation and installed dependency consistency: passed.
- Runtime smoke: signup, session, trial, wallet, room listing, readiness and
  same-origin API proxy passed against real local MongoDB.
- Missing LiveKit runtime path: correctly returned
  `LIVEKIT_NOT_CONFIGURED`/HTTP 503 with a request ID.

## Required Before Public Launch

1. Configure LiveKit and pass two-device publish/subscribe/reconnect tests.
2. Configure email and test verification plus password reset.
3. Set manual-bank details and/or validate a gateway sandbox webhook.
4. Rotate bootstrap credentials after first login.
5. Implement and enforce administrator TOTP MFA.
6. Add trusted AI usage enforcement before relying on credits for revenue.
7. Choose a real photorealistic face-processing provider/worker if that
   quality is a launch promise.
8. Configure backups, monitoring, alerting and incident response.
9. Run iPhone Safari, Android Chrome and weak-device acceptance tests.
10. Validate the AudioWorklet tone and local mask on real iPhone/Android
    hardware; automated mobile viewport checks cannot reproduce device thermal
    policies or Safari background-media suspension.

Until items 5-9 are closed, this is a production-oriented SaaS foundation,
not a claim that the full photorealistic AI service is ready for unrestricted
public sale.
