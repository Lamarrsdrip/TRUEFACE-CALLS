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
- Emergent LLM/universal-credit API for quality explanations, provider
  orchestration, fallback decisions, and admin diagnostics
- RunPod, Modal, Replicate or a custom GPU worker implementing the normalized
  TrueFace synchronous frame contract
- monitoring and WhatsApp
- Cloudflare R2/S3 for a later storage migration

All configurable credentials belong in `/admin/providers`. GridFS, local face
masking and browser voice tones need no external API key. Calls do not require
RunPod, Modal, Replicate, or Emergent LLM. A genuine cloud face swap still
needs a deployed GPU/video worker.
