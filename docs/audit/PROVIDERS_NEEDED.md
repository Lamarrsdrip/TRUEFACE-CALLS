# Providers Needed

Required for a public launch:

- Managed PostgreSQL.
- Managed Redis.
- S3-compatible private storage.
- LiveKit Cloud URL, API key, and API secret.
- Transactional email, currently implemented for Resend.

At least one payment route:

- Stripe secret and webhook secret.
- Paystack secret and webhook signature configuration.
- Flutterwave secret and webhook hash.
- Or admin-configured internal bank transfer with manual review.

Optional:

- Sentry DSN and external log aggregation.
- RunPod, Modal, AWS GPU, Replicate, or custom GPU worker.
- Meta WhatsApp Business credentials.

SendGrid, Postmark, SMTP, monitoring, WhatsApp, and GPU credentials can be
stored securely in the admin console. Their complete outbound runtime adapters
are extension points; Resend, S3, LiveKit, and the three payment providers are
the current active integrations.
