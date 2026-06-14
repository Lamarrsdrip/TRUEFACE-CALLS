# Known Limitations

- LiveKit must be configured and tested with two real devices.
- Local enhanced face masking is a tracked and feathered approved-image
  compositor. Blink and jaw signals influence the mask, but it is not neural,
  photorealistic identity replacement and cannot produce full expression,
  skin-detail or side-angle synthesis.
- Browser male/female voice tones are modest pitch/EQ effects. They are not
  formant-preserving identity conversion, voice cloning or studio-quality
  cloud conversion.
- The cloud frame gateway and browser publication path are wired, but the repo
  does not include or host a photorealistic GPU model. Admin must deploy a
  compatible RunPod, Modal, Replicate, or custom worker before cloud mode can
  process frames.
- The HTTPS cloud gateway currently targets two inference frames per second.
  A production high-FPS neural swap needs a streaming WebRTC/WebSocket GPU
  architecture and a model proven on the selected provider.
- Browser-side AI usage can be bypassed by a modified client. Trusted LiveKit
  telemetry or cloud leases are required for strong billing enforcement.
- Administrator TOTP enrollment/enforcement is not implemented.
- Paystack/Flutterwave recurring mandates and automatic renewals are not
  implemented; each approved payment grants one entitlement period.
- Email is optional for app startup but required for real verification and
  password-reset delivery.
- Full account-record erasure after the seven-day closure window needs an
  operational retention worker; biometric files are purged immediately.
- GridFS is adequate for initial managed deployment, not high-volume media
  archives.
- Browser and mobile Safari/Android behavior still needs real-device
  acceptance testing.
- Browser processing can be paused by mobile background-tab, thermal and
  battery policies; the UI warns and restores original tracks after failures.
