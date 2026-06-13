# Known Limitations

- Real calls require LiveKit credentials and provider acceptance testing.
- Gateway checkout requires real provider keys and registered webhook URLs.
- Transactional email requires a configured provider.
- Browser AI is a consented local compositor, not yet a photorealistic GPU
  replacement model.
- Cloud GPU execution requires a future external worker.
- Admin MFA is represented in the data model but TOTP enrollment/enforcement
  is not yet complete.
- MongoDB replica-set transactions should be enabled for the strongest
  multi-document billing guarantees. Idempotency keys permit safe recovery.
- GridFS is private and Emergent-native; very large deployments may later move
  files to S3 or R2 through the existing admin provider boundary.
