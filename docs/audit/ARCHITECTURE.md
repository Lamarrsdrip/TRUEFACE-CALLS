# Architecture

```mermaid
flowchart LR
  B["Phone or desktop browser"] --> N["Next.js frontend :3000"]
  N -->|"/api same origin"| F["FastAPI backend :8001"]
  F --> M["Emergent MongoDB"]
  M --> G["Private GridFS files"]
  F --> L["LiveKit Cloud or server"]
  F --> P["Manual bank / Paystack / Flutterwave"]
  F --> E["Gmail SMTP / SMTP / Resend"]
  B --> A["MediaPipe + Canvas local enhanced mask"]
  B --> V["Web Audio AudioWorklet voice tone"]
  F -. future .-> C["Emergent AI or GPU worker"]
```

MongoDB stores users, sessions, plans, subscriptions, wallets, ledger entries,
payments, rooms, participants, face metadata, consent, moderation, provider
settings and audit logs. GridFS stores private face images and receipts.

Provider secrets are encrypted with AES-256-GCM. Environment variables are
fallback values; an encrypted admin value overrides the matching fallback.

The storage and AI boundaries are adapter-ready. External R2/S3 and cloud
face inference are configuration contracts only; the active launch adapters
are GridFS, local face masking and browser voice-tone processing. Both
processed media tracks replace the original LiveKit publication and restore
the original track if publication fails.
