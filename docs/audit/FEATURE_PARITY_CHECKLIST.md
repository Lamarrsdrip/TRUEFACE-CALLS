# Feature Parity Checklist

Legend: `PRESERVE` means current behavior must remain; `VERIFY` means launch
needs provider-backed acceptance testing; `EXTEND` means architecture exists
but runtime work remains.

- PRESERVE: signup, login, sessions, email verification, password reset.
- PRESERVE: trial, Basic, Pro, and Business plan entitlements.
- PRESERVE: included monthly credits and durable purchased credits.
- PRESERVE: trial users cannot buy top-ups.
- PRESERVE: server-authoritative credit quotes, reservations, settlement, and
  release.
- PRESERVE: Stripe, Paystack, Flutterwave, and manual bank-transfer checkout.
- PRESERVE: bank-transfer proof upload, pending review, approval/rejection,
  activation, and audit logs.
- PRESERVE: multi-image face profiles with front, side, lighting, and
  expression roles.
- PRESERVE: consent logs, readiness score, moderation, deletion, and private
  signed storage.
- PRESERVE: persistent call rooms and host-owned room list.
- PRESERVE: host enters as host, not as a guest waiting-room participant.
- PRESERVE: host sees waiting participants and can approve/reject in the room
  UI.
- PRESERVE: participant approval verifies room ownership then updates by valid
  Prisma unique selector.
- VERIFY: LiveKit configured state, token generation, room join, publish,
  subscribe, reconnect, and room end.
- EXTEND: system health with LiveKit, storage, database, Redis, payment,
  email, GPU, webhook, room, and token-generation signals.
- EXTEND: optional GPU provider architecture for HD GPU and Ultra GPU modes.
- PRESERVE: browser-local AI as default with adaptive low, standard, and high
  modes.
- EXTEND: recommended devices page and richer device benchmark reporting.
