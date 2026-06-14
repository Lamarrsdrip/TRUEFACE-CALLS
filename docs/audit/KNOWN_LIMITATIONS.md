# Known Limitations

- LiveKit must be configured and tested with two real devices.
- Browser AI is a static approved-image compositor driven by landmarks. It
  does not yet synthesize photorealistic eye, blink, mouth or expression
  transfer.
- The cloud AI/GPU fields are adapter configuration; no cloud inference worker
  is wired into the media path.
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
