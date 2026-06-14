# GPU Face Replacement Architecture

## Default Local Path

Camera -> MediaPipe Face Landmarker -> browser acceleration where available ->
Canvas 2D compositing -> processed `MediaStreamTrack` -> LiveKit.

The raw camera publication is removed before the processed track is published.
If processing cannot start, the app restores the raw camera and shows a
warning. No cloud account is required.

## Optional Cloud Path

Camera frame -> `POST /api/ai/face/process-frame` -> authenticated backend
gateway -> configured GPU worker -> processed image -> browser canvas track ->
LiveKit.

The backend verifies:

- signed-in user
- approved room participation
- owned and approved face profile
- room availability
- image data URL type, signature, and size
- configured encrypted GPU credentials

Frames are handled in memory and are not stored.

## Worker Contract

`GPU_INFERENCE_URL` receives a Bearer-authenticated JSON POST:

```json
{
  "frame": "data:image/jpeg;base64,...",
  "faceProfileId": "profile-id",
  "faceProfileImage": "data:image/jpeg;base64,...",
  "qualityMode": "standard",
  "roomId": "room-id",
  "requestId": "request-id"
}
```

Expected response:

```json
{
  "processedFrame": "data:image/jpeg;base64,...",
  "latencyMs": 120,
  "providerStatus": "OPERATIONAL",
  "capabilities": {
    "realtime": true,
    "photorealistic": false
  }
}
```

RunPod, Modal, Replicate, or custom infrastructure should be placed behind
this contract. The provider account alone is insufficient; a model worker or
adapter must be deployed.

## Health

`GET /api/ai/face/provider-health` reports:

- local mode availability
- Emergent LLM configuration and last test state
- GPU configuration, active health result, capabilities, and latency
- effective local/cloud mode

Missing or unhealthy GPU configuration returns local mode and
`Unavailable / provider not configured`. It does not break calls.
