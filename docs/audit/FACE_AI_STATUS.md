# Face AI Status

## What Is Real Today

- Browser-local camera capture and preflight.
- MediaPipe-ready face tracking architecture.
- Canvas/WebGL-style processed-track publication contract.
- Raw camera track is unpublished before AI processed output is published.
- AI active disclosure is visible in the call UI and LiveKit metadata.
- Tracking degradation can pause AI output.
- Device-aware low, standard, and HD quality profiles exist.
- Multi-image face profiles are validated, privately stored, and scored.

## What Is Not Yet Full GPU Face Replacement

- The current browser processor uses the front face image.
- Side-angle, lighting, and expression images improve readiness and future data
  quality, but they do not yet train or run a multi-view model.
- The current system is a consented browser-local face effect/compositing
  foundation, not a claimed photorealistic identity model.

## What Requires GPU Providers

- Multi-view identity modeling.
- High-fidelity expression transfer.
- Robust side-angle replacement.
- Advanced relighting and temporal consistency.
- HD and Ultra cloud processing modes.

## Default Strategy

Default product mode is phone/browser-local processing:

- Low Mode: 360p and lower FPS for weaker phones.
- Standard Mode: 480p stable mobile output.
- High Mode: 720p when device capability allows.

Cloud GPU is optional and should be enabled only when admin allows it, the
user plan includes it, credits are sufficient, and latency is acceptable.
