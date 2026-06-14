# TrueFace Realtime Media Upgrade Design

## Scope

Upgrade the existing Emergent-native TrueFace Calls foundation without repeating
the completed repository audit. The release adds persisted profile preferences,
truthful processing labels, improved local face masking, a real browser audio
tone processor, device guidance, and per-user admin feature restrictions.

## Processing Modes

- **Local enhanced face mask** runs in the browser with MediaPipe tracking and
  Canvas/WebGL-capable browser primitives. It publishes a processed LiveKit
  video track, smooths motion, adapts scale/rotation/lighting, feathers edges,
  and pauses safely when tracking is lost. It is not described as
  photorealistic face swap.
- **Cloud AI face swap** is only available when a configured realtime GPU
  worker reports a healthy face-video capability. Emergent LLM credits alone
  do not imply this capability.
- **Unavailable / provider not configured** is shown whenever cloud processing
  lacks a verified realtime worker. The call must not fail because cloud AI is
  absent; local mode or the original camera remains usable.
- **Browser voice tone** uses Web Audio and AudioWorklet processing to publish a
  transformed microphone track. It offers modest male/female tone shifts and
  is not represented as identity-changing AI voice conversion.

## Data And Controls

Users store `gender` (`MALE`, `FEMALE`, `UNSET`) and `voicePreference`
(`MALE_TONE`, `FEMALE_TONE`, `ORIGINAL`). Face readiness is computed from saved
profiles rather than duplicated onto the user record. Admins can disable face
or voice processing independently for a user, with audit logs and server-side
enforcement.

Plans retain Naira billing and gain an explicit subscription duration separate
from the credit-reset window. Phone recommendations are advisory. A local
capability check uses browser/OS hints, logical cores, memory when exposed,
WebGL/WebGPU support, a short FPS sample, optional camera resolution, battery,
and page visibility signals. It never unfairly blocks a user.

## Failure Handling

Track replacement is transactional from the UI perspective: if processed video
or audio publication fails, TrueFace republishes the original track and shows a
human-readable warning. Unsupported AudioWorklet or canvas capture is reported
before enabling the effect. LiveKit, cloud AI, and storage errors retain their
existing typed API responses instead of becoming generic HTTP 500 errors.

## Verification

Backend tests cover profile validation/persistence, admin restrictions, plan
duration, and enforcement. Frontend unit tests cover device ratings, processing
labels, processed-track publication, and original-track fallback. Final
verification includes backend tests, frontend tests, TypeScript, lint,
production build, dependency checks, and browser smoke tests.
