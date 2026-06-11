# TrueFace Calls Audit Package

This directory is the reviewer handoff for the `codex/trueface-foundation`
branch. Start with `ARCHITECTURE.md`, then review the domain-specific files.

## Verification Commands

```bash
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run test
npm run typecheck
npm run build
```

Emergent uses:

```bash
npm ci && npm run db:generate && npm run build
npm run start:deploy
```

## Review Priorities

1. Subscription and wallet invariants in `apps/api/src/billing` and
   `apps/api/src/credits`.
2. Face consent, private object lifecycle, and moderation in
   `apps/api/src/faces`.
3. Signed invite and LiveKit publication behavior in `apps/api/src/rooms` and
   `apps/web/components/call-room-client.tsx`.
4. Provider credential encryption in `apps/api/src/providers`.
5. Admin permission checks and audit records in `apps/api/src/admin`.

No production provider secret is committed. `.env.example` contains names and
safe placeholders only.
