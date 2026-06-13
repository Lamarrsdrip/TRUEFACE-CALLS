# Call Room Flow

1. A subscribed host creates a room with expiry, guest, password, participant,
   and waiting-room policy.
2. The API stores the room and signs an invite containing room ID, invite
   version, and expiry.
3. The API returns a guest `inviteUrl` and a host-only UX `hostUrl`; host
   authority still comes from the signed-in creator and server-side role.
4. `/calls` regenerates valid host and guest links for the host, so leaving
   the creation page does not lose the room.
5. Guests or users open the browser link, run camera/microphone preflight, and
   request entry.
6. Waiting participants require host approval before a LiveKit token is issued.
7. The host can enter immediately, see waiting participants, admit/reject
   guests, copy the invite, rejoin, share it, or end the room.
8. End actions terminate LiveKit and update the room/history record.

AI activation first reserves five estimated minutes. The raw camera is
unpublished before the processed track is published. Metering settles in
idempotent windows. Tracking failure pauses AI output, and disabling AI
releases unused reservation credit.
