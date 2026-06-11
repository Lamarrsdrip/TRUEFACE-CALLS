# Known Limitations

- The browser media engine is a consented real-time compositing foundation,
  not a claimed production-grade photorealistic identity model.
- Multiple face images are validated and stored, but the current browser
  processor uses the front image. Multi-view GPU training/inference is a
  future adapter.
- Email delivery currently executes through Resend. Other email providers are
  securely configurable but require outbound adapters.
- GPU, WhatsApp, and monitoring providers have secure settings and health
  structure but require service-specific runtime adapters.
- Stripe recurring invoice lifecycle handling should be expanded for full
  renewal, proration, dispute, and dunning coverage before broad launch.
- Paystack and Flutterwave recurring subscriptions depend on the chosen
  commercial product configuration and need provider-account acceptance tests.
- Admin MFA fields and policy are ready, but TOTP/WebAuthn enrollment and
  challenge screens are not yet implemented.
- Emergent must supply or connect managed PostgreSQL because the app uses
  Prisma/PostgreSQL rather than MongoDB.
- `npm audit` currently reports two moderate advisories against the exact
  PostCSS version nested inside Next.js 16.2.9. The available forced npm fix
  proposes a breaking downgrade to Next.js 9, so it was not applied. Track the
  upstream Next.js dependency update and rerun the audit before launch.
