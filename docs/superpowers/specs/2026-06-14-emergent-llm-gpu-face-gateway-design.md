# Emergent LLM and GPU Face Gateway Design
## Goal

Separate AI reasoning from real-time media inference:

- Emergent LLM is an optional orchestration and diagnostics service.
- Browser MediaPipe/WebGL processing remains the default low-latency mode.
- A separately configured GPU worker performs actual cloud face-frame inference.
- The product never labels LLM access as a working face-swap engine.

## Processing Modes

### Local

Camera track -> browser video element -> MediaPipe landmarks -> canvas/WebGL
composition -> processed canvas track -> LiveKit.

No raw camera track is published while the local effect is active.

### Cloud

Camera frame -> authenticated TrueFace backend gateway -> configured GPU worker
-> processed image -> browser canvas track -> LiveKit.

The gateway validates room participation, face-profile ownership and approval,
frame size, image type, and provider health. Frames are held in memory only and
are not persisted.

The first version uses a bounded low frame rate over HTTPS. It is a real
inference integration when a compatible worker is configured, but it is not
presented as high-FPS or photorealistic unless the worker reports those
capabilities.

## Provider Responsibilities

### Emergent LLM

Emergent LLM may help with provider selection, deterministic quality-result
explanations, fallback recommendations, and admin diagnostics. Its failure does
not stop local processing or the GPU frame path. Numeric quality metadata is
sent by default; face images are not sent to the LLM.

Because no public authoritative Emergent endpoint contract is available in the
repository, the adapter uses an admin-configurable base URL, health path, and
OpenAI-compatible chat path. No unsupported endpoint is hardcoded as a platform
guarantee.

### GPU worker

`GPU_INFERENCE_URL` must point to a TrueFace-compatible synchronous worker or
adapter. It receives:

```json
{
  "frame": "data:image/jpeg;base64,...",
  "faceProfileId": "...",
  "faceProfileImage": "data:image/jpeg;base64,...",
  "qualityMode": "standard",
  "roomId": "...",
  "requestId": "..."
}
```

It returns:

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

Provider-specific RunPod, Modal, Replicate, or custom infrastructure should be
placed behind this normalized contract. This avoids claiming that incompatible
vendor APIs can process live frames directly.

## Public API

`POST /api/ai/face/process-frame`

- Requires a signed-in user and valid CSRF token.
- Requires an active approved room participant.
- Requires an owned, approved, active face profile.
- Rejects malformed or oversized frames.
- Returns `processedFrame`, `latencyMs`, and `providerStatus`.
- Returns a clear `GPU_PROVIDER_NOT_CONFIGURED` or
  `GPU_INFERENCE_FAILED` error instead of a generic 500.

`GET /api/ai/face/provider-health`

- Reports local browser availability requirements.
- Reports Emergent LLM configuration and last test state.
- Actively checks the GPU worker when configured.
- Reports the effective mode and fallback mode without exposing credentials.

## Fallback

- `AI_FACE_PROVIDER=local` always selects local processing.
- `AI_FACE_PROVIDER=cloud` selects cloud only when the GPU provider is
  configured and operational.
- Missing or unhealthy GPU configuration resolves to local enhanced face mask
  and reports why cloud is unavailable.
- A failed cloud startup does not publish the raw camera as an AI output.

## Security

- Provider credentials are encrypted in admin settings.
- Environment values remain fallback-only.
- Frame payloads are limited to supported image data URLs and bounded decoded
  size.
- The gateway verifies room and face-profile authorization on every request.
- Frames and returned inference images are never written to MongoDB or GridFS.
- Logs contain request IDs and provider status, not image data or secrets.
