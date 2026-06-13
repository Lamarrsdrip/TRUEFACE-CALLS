# GPU Face Replacement Architecture

## Provider Abstraction

The GPU provider contract should support:

- RunPod.
- Modal.
- AWS GPU.
- Lambda Labs.
- Replicate.
- Custom HTTPS/WebRTC GPU worker endpoint.

Admin settings:

- provider name.
- endpoint URL.
- API key.
- model name and version.
- quality mode.
- cost per minute.
- enabled/disabled.
- test connection.

## Modes

- Browser Mode: local phone/laptop processing.
- HD GPU Mode: cloud-enhanced 720p.
- Ultra GPU Mode: business-tier high fidelity and higher credit burn.

## Pipeline

Camera frame -> frame encoder -> GPU endpoint -> processed frame ->
browser compositor/decoder -> LiveKit processed track.

The raw camera track must remain unpublished while AI mode is active. If GPU
latency, dropped frames, or provider errors exceed policy thresholds, the room
falls back to Browser Mode and records a provider health event.

## Metrics

- GPU latency.
- FPS.
- dropped frames.
- processing time.
- error rate.
- cost per minute.
- credit charge per minute.

## Billing

GPU mode uses the same server-authoritative credit engine. Browser clients can
request GPU mode, but the API decides availability, rate, plan entitlement,
and reservation size.
