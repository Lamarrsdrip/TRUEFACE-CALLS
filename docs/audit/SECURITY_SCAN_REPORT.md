# Security Review: TrueFace Calls

## Scope

- **Scan mode:** Repository-wide review of the deployed runtime in
  `backend/`, `frontend/`, root deployment configuration, and CI.
- **Generated context:** The threat model was generated during Phase 1 from
  repository code and deployment documentation.
- **Artifacts reviewed:** 125 runtime/configuration files, with per-file
  completion receipts in the work ledger and a repository coverage ledger.
- **Validation:** Static source-to-control tracing plus focused HTTP, GridFS,
  payment, provider, credit-meter, and call-diagnostic regression tests.
- **Exclusions:** Generated `.next` output, dependency directories, historical
  planning documents, and dormant non-deployed `apps/`/`packages/` output.
  Emergent starts the `frontend/` and `backend/` applications only.
- **Limitations:** No live penetration test was performed against a deployed
  Emergent URL, LiveKit tenant, payment provider, or physical mobile device.

### Scan Summary

| Field | Value |
|---|---|
| Reportable findings | 2 |
| Severity mix | 2 Medium; 0 Critical; 0 High; 0 Low |
| Confidence mix | 2 High |
| Closed during audit | 7 candidates |
| Coverage | 125 deployed runtime/configuration files with closure receipts |
| Validation mode | Source review plus focused regression tests |

Primary artifacts:

- Threat model:
  `artifacts/01_context/threat_model.md`
- Coverage ledger:
  `artifacts/03_coverage/repository_coverage_ledger.md`
- Validation summary:
  `artifacts/05_findings/validation_summary.md`
- Attack-path summary:
  `artifacts/05_findings/attack_path_analysis_report.md`

## Threat Model

TrueFace Calls is a mobile-first SaaS for authenticated and guest browser video
calls, consent-controlled face profiles, device-local AI processing,
subscriptions, credits, provider configuration, and administrative moderation.
The deployed runtime is the Next.js application in `frontend/` and FastAPI
application in `backend/`, backed by MongoDB and private GridFS.

Principal assets are account/session integrity, biometric face images and
consent records, payment and credit ledgers, signed call invitations, LiveKit
credentials and tokens, administrator privileges, encrypted provider secrets,
and audit history.

### Trust Boundaries And Assumptions

- Public browsers are untrusted. Signup, login, guest joins, signed invite
  parameters, uploads, payment references, reports, and JSON bodies are
  attacker-controlled.
- Authenticated users are mutually untrusted. Ownership boundaries must hold
  for rooms, face profiles, private files, wallets, subscriptions, and
  payments.
- Administrators are privileged operators. Login, recent-auth checks,
  permissions, payment approval, provider secrets, moderation, and credit
  adjustment form a high-value boundary.
- MongoDB and GridFS are trusted infrastructure, but legacy values and partial
  operations must be handled safely and idempotently.
- LiveKit, Paystack, Flutterwave, email, monitoring, WhatsApp, object storage,
  and future cloud AI/GPU services are external trust boundaries.
- Browser MediaPipe/Canvas processing needs no cloud AI key. Future cloud AI
  introduces biometric-data egress and usage cost.

### Main Attack Surfaces

- Authentication, sessions, password reset, and administrator access.
- Signed room invitations, waiting-room controls, and LiveKit token issuance.
- Face uploads, ownership, consent, private download, and physical deletion.
- NGN billing, manual approval, provider webhooks, and credit fulfillment.
- Provider credential encryption, recent authentication, and connection tests.
- Public API inputs, object authorization, redirects, errors, and rate limits.

Realistic attackers are unauthenticated internet users, malicious account
holders, compromised browsers, payment fraudsters, and attackers holding a
stolen administrator password.

## Findings

| Severity | Finding | Confidence |
|---|---|---|
| Medium | [Modified browser clients can bypass AI usage settlement](#1-modified-browser-clients-can-bypass-ai-usage-settlement) | High |
| Medium | [Administrator MFA requirement is modeled but not enforced](#2-administrator-mfa-requirement-is-modeled-but-not-enforced) | High |

### Confidence Scale

| Label | Meaning |
|---|---|
| high | Direct source, configuration, or runtime evidence supports the finding, with no material unresolved reachability or exploitability blocker. |
| medium | Source evidence supports a plausible issue, but runtime behavior, deployment configuration, role reachability, type constraints, or exploit reliability still need proof. |
| low | Weak or incomplete evidence; retained only for explicit follow-up. |

### [1] Modified browser clients can bypass AI usage settlement

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | Direct source tracing shows that only the browser knows whether local AI frames continue, while server regression tests confirm it owns rates but not processing evidence. |
| Category | Client-side enforcement of billing |
| CWE | CWE-602: Client-Side Enforcement of Server-Side Security |
| Affected lines | `frontend/components/call-room-client.tsx:664-666`; `backend/app/routers/credits.py:190-219` |

#### Summary

The production client settles device-local AI usage every 15 seconds. A
modified browser can keep publishing the processed track while omitting those
settlement requests. Server-owned prices, reservations, and wallet checks stop
rate tampering and cross-account debits, but they cannot prove that locally
rendered AI frames were consumed.

#### Validation

- Method: static source-to-control trace plus server credit-meter regression
  tests.
- Confirmed: authenticated entrypoint, client-controlled settlement cadence,
  server-owned rates, and concrete revenue-integrity impact.
- Remaining uncertainty: no trusted LiveKit telemetry or cloud lease exists in
  the checked-out runtime.

#### Dataflow

Browser AI activation -> `setInterval(settleAiWindow, 15000)` -> credit
settlement API -> server reservation ledger -> user's wallet. A modified client
removes the interval/API step while retaining local rendering and track
publication.

#### Reachability

An ordinary authenticated subscriber with a valid room and face profile can
modify browser code or suppress API calls remotely. The impact is limited to
underpaying for that account's own local AI usage; the path does not create
credits, access another wallet, or expose biometric data.

#### Severity

Final severity is **Medium**. Billing integrity can be materially affected at
scale, but exploitation requires a technically capable authenticated user and
has single-account impact. Evidence that a trusted server-side media meter can
reliably correlate each published AI track with settled time would lower or
close the finding.

#### Remediation

- Issue short-lived, server-observed AI media leases.
- Correlate LiveKit participant/track telemetry with active reservations.
- Stop or unpublish AI tracks when a lease expires.
- Add reconciliation alerts for AI-active metadata without matching settled
  usage.
- Keep cloud GPU processing server-authorized and server-metered when added.

### [2] Administrator MFA requirement is modeled but not enforced

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Confidence rationale | The bootstrap record sets `mfaRequired`, while direct authentication tracing proves the admin login creates a full session after password verification alone. |
| Category | Missing multifactor authentication enforcement |
| CWE | CWE-308: Use of Single-factor Authentication |
| Affected lines | `backend/app/seed.py:271-280`; `backend/app/routers/auth.py:246-267` |

#### Summary

Administrator records declare that MFA is required, but the admin login route
does not enroll, challenge, or verify a second factor. A stolen valid
administrator password therefore starts a fully privileged session.

#### Validation

- Method: authentication code trace and administrator response inspection.
- Confirmed: password-only login, active-admin lookup, immediate session
  creation, and returned MFA metadata without enforcement.
- Remaining uncertainty: an external identity-aware proxy could add MFA, but no
  such deployment control exists in this repository.

#### Dataflow

Attacker-supplied admin email/password -> password verification -> active
`admin_users` lookup -> `_start_session()` -> access to privileged routes.
`mfaRequired` and `mfaEnabled` are returned only as metadata.

#### Reachability

The endpoint is remotely reachable, but the attacker first needs a valid
administrator password. Existing Argon2 hashing, rate limits, HttpOnly cookies,
CSRF controls, permissions, and recent-auth checks reduce likelihood and some
post-login abuse. They do not provide an independent factor.

#### Severity

Final severity is **Medium**. A successful path can reach sensitive payment,
provider, moderation, and settings operations, but it depends on prior admin
credential compromise. Proof of an unauthenticated bypass or broadly reusable
default admin credential would raise severity; deployment-level enforced MFA
would lower or close it.

#### Remediation

- Implement TOTP or WebAuthn enrollment and challenge.
- Do not create a privileged session while required MFA is incomplete.
- Add recovery codes, revocation, replay prevention, and step-up tests.
- Require MFA challenge for payment approval, provider credential changes, and
  manual credit adjustment.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
|---|---|---|---|
| Browser AI and credit meter | Client trust / billing | Reported | Local processing cannot yet be independently observed by the server. |
| Admin authentication | Identity / privilege | Reported | MFA flags exist but no challenge is enforced. |
| Face upload/profile creation | IDOR / private biometric data | Rejected | Ownership prefix, GridFS existence, MIME and non-reuse checks added and tested. |
| Face/account deletion | Privacy deletion | Rejected | Shared helper now physically purges GridFS bytes and metadata. |
| Manual bank approval and provider fulfillment | Duplicate value / fake success | Rejected | Atomic fulfillment marker and idempotent ledger added and tested. |
| Paystack/Flutterwave webhooks | Forgery / state corruption | Rejected | Missing secrets fail closed; signatures, terminal events, exact NGN value, and idempotency enforced. |
| Provider settings | Secret leakage / control bypass | Rejected | Generic provider namespace blocked; encrypted provider route retains recent-auth and RBAC. |
| Production configuration | Default secrets | Rejected | Non-local startup refuses default or weak security keys. |
| Call join and expiration | Availability / error disclosure | Rejected | UTC normalization and coded errors replace the generic 500. |
| Sessions, CSRF, redirects, API validation | Web security | No issue found | Argon2, HttpOnly cookies, CSRF, bounded redirects, validation, and request IDs reviewed. |
| Storage and private downloads | Object access / upload safety | No issue found | GridFS objects are private and downloads/uploads use scoped one-time signed tokens. |
| Admin search and moderation | Injection / object state | No issue found | Regex input is escaped/bounded and state transitions validate target records. |

## Open Questions And Follow Up

- Implement and review trusted AI usage leases around
  `frontend/components/call-room-client.tsx` and
  `backend/app/routers/credits.py`.
- Implement and review administrator TOTP/WebAuthn enforcement around
  `backend/app/routers/auth.py`.
- Run a deployed two-device LiveKit test covering guest join, waiting room,
  reconnect, AI toggle, and exhausted credits.
- Run Paystack and Flutterwave sandbox callback tests with real provider
  signatures before enabling either provider.
- Run iPhone Safari and Android Chrome acceptance tests against the Emergent
  HTTPS preview.
