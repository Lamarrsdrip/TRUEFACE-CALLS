# Call Room Flow

1. A subscribed host creates a room with expiry, guest, password, participant,
   and waiting-room policy.
2. The API stores the room and signs an invite containing room ID, invite
   version, and expiry.
3. `/calls` regenerates the valid signed link for the host, so leaving the
   creation page does not lose the room.
4. Guests or users open the browser link, run camera/microphone preflight, and
   request entry.
5. Waiting participants require host approval before a LiveKit token is issued.
6. The host can rejoin, copy the link, share it, or end the room.
7. End actions terminate LiveKit and update the room/history record.

AI activation first reserves five estimated minutes. The raw camera is
unpublished before the processed track is published. Metering settles in
idempotent windows. Tracking failure pauses AI output, and disabling AI
releases unused reservation credit.
