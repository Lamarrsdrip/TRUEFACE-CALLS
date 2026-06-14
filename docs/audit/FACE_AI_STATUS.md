# Face AI Status

## What Is Real Today

- Browser-local camera capture and preflight.
- MediaPipe-ready face tracking architecture.
- Smoothed face-oval masking with scale, rotation, feathering, local lighting,
  anti-jitter motion and blendshape-responsive jaw/blink cues.
- Raw camera track is unpublished before the processed output is published.
- Local enhanced face mask disclosure is visible in the UI and LiveKit metadata.
- Tracking degradation can pause AI output.
- Device-aware low, standard, and HD quality profiles exist.
- Multi-image face profiles are validated, privately stored, and scored.

## What Is Not Yet Full GPU Face Replacement

- The current browser processor uses the approved front face image.
- Side-angle, lighting, and expression images improve readiness and future data
  quality, but they do not yet train or run a multi-view model.
- The current system is labelled **Local enhanced face mask**, not
  photorealistic face swap.

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

Cloud UI status remains **Unavailable / provider not configured** until a real
realtime GPU worker reports healthy face-video capability. Emergent LLM or
universal credits by themselves do not provide a realtime video inference
worker.
