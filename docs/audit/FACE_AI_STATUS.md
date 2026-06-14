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
- Local processing is the default and needs no cloud GPU provider.
- Local initialization selects WebGPU/WebGL capability where available,
  falls back to CPU-backed MediaPipe plus Canvas 2D, and restores the raw
  camera with a visible warning only if processed canvas output cannot start.
- The authenticated cloud frame gateway and processed canvas publication are
  implemented for compatible external GPU workers.

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

Cloud UI status remains **Unavailable / GPU not configured** until a real GPU
worker passes its health check. Selecting cloud preference without a working
GPU automatically resolves to local enhanced face mask and does not block call
creation. Emergent LLM or universal credits by themselves do not provide a
realtime video inference worker.

## Emergent LLM Role

Emergent LLM is optional and is used only for:

- metadata-only face quality explanations
- provider and fallback recommendations
- admin AI diagnostics
- human-readable error guidance

It does not receive live frames by default and is never used as the actual
face-swap engine.
