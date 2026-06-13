# Host/Guest Call Bug Analysis

## Observed Failure

The host creates a room, opens the returned call URL, and sees the same
preflight/waiting behavior as a guest. A guest opening the same URL also waits.
Because the active room UI has no waiting-participant host panel, nobody can
approve the guest and the call never starts.

## Root Cause Evidence

- Room creation correctly creates a `CallParticipant` with `role: HOST` and
  `state: APPROVED`.
- The create-call UI only receives and opens `inviteUrl`, which is a generic
  guest invite URL.
- The call room page does not receive explicit host context or a host-aware
  route.
- The room preflight button is disabled when `allowGuests` is true and the name
  field is empty, even for authenticated users.
- The call room experience contains media, chat, AI, and end controls, but no
  waiting participant list or approve/reject controls.
- `RoomsService.decideParticipant()` updates with `where: { id, roomId }`,
  which is invalid for the current Prisma schema because only `id` is unique.

## Required Fix

- Return a dedicated `hostUrl` from room creation and room list APIs.
- Allow signed invite resolution to report whether the current authenticated
  user is the host.
- Let the host request a LiveKit token immediately.
- Keep non-host users and guests on the waiting-room path when waiting room is
  enabled.
- Add host controls in the active room for waiting participants, approval,
  rejection, copy link, lock/end status, and participant visibility.
- Verify participant ownership before update, then update by `where: { id }`.
- Set room `startedAt` only when an approved participant receives a token and
  waiting-room time has not yet counted as active call time.

## Fix Status

Implemented in the 2026-06-13 hardening pass:

- Room creation and host room lists now return separate `hostUrl` and
  `inviteUrl` values.
- Host URLs add `host=1` as UX intent, while authorization still comes from
  the signed-in room creator and server-side participant role.
- The room preflight no longer requires a guest display name for host entry.
- The host can enter through the approved host participant and receive a
  LiveKit token without waiting-room approval.
- Host room entry sets `startedAt` and moves the room to `ACTIVE`.
- Participant approval verifies room membership first, then updates by unique
  participant ID.
- The active call UI includes a host panel for waiting participants, admit,
  reject, copy invite, participant count, and room status.
