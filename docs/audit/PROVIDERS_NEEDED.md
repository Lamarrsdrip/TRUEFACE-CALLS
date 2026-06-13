# Providers Needed

Emergent handles frontend hosting, FastAPI hosting, MongoDB, deployment,
environment injection, HTTPS and preview/production URLs.

External accounts required only when activating their features:

- LiveKit Cloud or compatible LiveKit server.
- Stripe, Paystack and/or Flutterwave.
- Transactional email or SMTP.
- Optional S3/R2 if replacing GridFS.
- Optional RunPod, Modal, AWS, Replicate or custom GPU processing.
- Optional monitoring and WhatsApp providers.

Enter credentials in `/admin/providers`; do not expose them to the frontend.
