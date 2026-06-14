# Providers Needed

Emergent can handle:

- frontend and FastAPI hosting
- MongoDB
- GridFS private files for the initial launch
- environment secrets, HTTPS, logs and preview/production URLs

Required external account for calls:

- LiveKit Cloud or a compatible LiveKit server

Required for production account recovery:

- Gmail App Password, custom SMTP, or Resend

Optional:

- Paystack and/or Flutterwave; manual bank works without a gateway
- Emergent AI gateway, if Emergent supplies real-time face-video capability
- RunPod, Modal, AWS, Replicate or custom GPU worker
- monitoring and WhatsApp
- Cloudflare R2/S3 for a later storage migration

All configurable credentials belong in `/admin/providers`. GridFS and browser
AI need no external API key.
