# Production Readiness

## Ready

- Emergent-native repository layout.
- FastAPI/MongoDB startup and idempotent seed.
- Secure authentication and encrypted settings.
- Subscription, credits, rooms, face consent, manual payments and admin APIs.
- Mobile-first frontend and same-origin API ingress.
- Automated backend and frontend verification workflows.

## Before Public Launch

1. Deploy and rotate bootstrap credentials.
2. Configure LiveKit and run two-device call acceptance tests.
3. Configure one payment gateway and validate signed webhooks.
4. Configure transactional email.
5. Enable MongoDB backups and replica-set transaction support.
6. Enforce administrator TOTP MFA.
7. Configure monitoring, alerting and a production CSP.
8. Review pricing with the admin cost calculator.
