# Call Room Flow

1. The host creates a persisted MongoDB room.
2. The API signs an invite with room ID, invite version and expiry.
3. The dashboard can regenerate, copy and reopen the link later.
4. Guests or signed-in users present the invite and optional password.
5. Waiting-room participants need host approval.
6. Approved participants receive a LiveKit JWT.
7. LiveKit creates the media room on first join.
8. Host/admin end actions persist room and history state.

Specific API errors cover room missing, invite invalid, password incorrect,
call expired, participant not approved, LiveKit missing and token failure.
MongoDB datetimes are normalized to UTC, fixing the original call-link 500:

```text
TypeError: can't compare offset-naive and offset-aware datetimes
backend/app/routers/rooms.py
```

When AI starts, the client reserves server-priced credits, unpublishes the raw
camera and publishes the processed canvas track. Tracking loss pauses the AI
output. Disabling AI restores the raw camera and releases unused credit.
