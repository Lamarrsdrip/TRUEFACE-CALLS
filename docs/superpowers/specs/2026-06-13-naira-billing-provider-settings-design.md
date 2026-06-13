# Naira Billing And Provider Settings Design

## Goal

Make TrueFace Calls a Nigeria-first subscription product with Nigerian Naira
pricing, a polished manual bank-transfer checkout, and provider settings that
clearly distinguish required launch infrastructure from optional integrations.

## Billing Model

- `NGN` is the only application billing currency.
- Amounts remain integers in minor units (kobo) in MongoDB.
- Manual bank transfer is the default checkout method.
- Paystack and Flutterwave remain optional gateway adapters.
- Stripe is removed from provider definitions, checkout code, webhooks, UI,
  contracts, and documentation.
- Existing USD seed records are migrated to explicit Naira launch defaults.
  Admin-edited records are not overwritten on every application start.

## Manual Transfer Sessions

Starting checkout creates a payment session before the customer transfers
money. Each session contains:

- the exact amount in kobo and `NGN` currency;
- a unique `TFC-XXXXXX` payment reference;
- an administrator-configurable expiry time;
- the selected plan or credit-pack snapshot;
- `PENDING`, `APPROVED`, `REJECTED`, or `EXPIRED` status;
- optional bank transfer reference and private proof object key.

The checkout page shows bank details, amount, payment code, countdown, optional
proof upload, and live status. Expiry is enforced whenever payments are read or
reviewed. An administrator may still approve an expired payment. Approval is
idempotent and activates the subscription or credits exactly once. Every
decision records the reviewer, amount, plan/pack, date, reference, and notes in
the audit log.

## Provider Configuration

The provider API computes one of three configuration states:

- `CONFIGURED`: all fields required for the selected mode are present;
- `PARTIALLY_CONFIGURED`: at least one value exists but required values are
  missing;
- `UNCONFIGURED`: no usable setup exists.

Connection-test health is reported separately from configuration completeness.
The admin UI uses guided forms, helper text, provider descriptions, readable
test results, and responsive navigation.

### Provider Roles

- LiveKit: required for real multi-user video calls.
- Storage: MongoDB GridFS is the built-in Emergent-native default. External
  S3/R2 settings are optional migration settings for larger file workloads.
- Paystack and Flutterwave: optional automatic Naira checkout.
- Email: required for production verification and password-reset delivery.
- AI: browser mode needs no API key; cloud AI needs its provider credentials.
- GPU: optional paid cloud processing.
- Manual Bank: primary payment path and required when gateways are not enabled.
- Monitoring: optional production error reporting.
- WhatsApp: optional notifications/support integration.

## Email

Supported modes:

- Gmail SMTP: sender email, sender name, and Google App Password. Host and TLS
  defaults are applied by the backend.
- Custom SMTP: host, port, username, password, sender identity, and TLS mode.
- Resend: API key and sender identity.

The backend provides a real send-test-email action and uses the same adapter for
verification and password-reset messages. Normal Gmail account passwords are
never requested.

## Storage

The active launch implementation stores private uploads in MongoDB GridFS.
This is database-backed file storage, distinct from normal MongoDB document
collections, and is sufficient for face images and payment receipts at early
launch scale. It is not intended for long video archives or high-volume
generated media. Cloudflare R2 is the recommended later object-storage target,
but no external storage account is required for the initial Emergent launch.

## Security

- Provider secrets remain AES-256-GCM encrypted and are returned only as
  fingerprints.
- Manual payment approval never occurs from the customer screen.
- Payment proof files remain private and use signed, expiring reads.
- Payment status transitions and fulfillment are idempotent.
- Admin changes and payment decisions remain audited.

## Verification

- Backend tests cover Naira-only data, provider status calculation, session
  creation, expiry, optional narration, and expired-payment approval.
- Frontend tests cover Naira formatting and payment status labels.
- Production build, TypeScript, backend compilation, and dependency audit must
  pass.
- Browser QA covers provider settings and bank checkout at desktop and mobile
  widths.
