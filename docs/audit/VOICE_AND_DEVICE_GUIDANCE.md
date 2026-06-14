# Voice And Device Guidance

## Browser Voice Tone

Users can save `Original voice`, `Default male tone`, or `Default female tone`.
In a call, supported Pro/Business users can enable the browser voice tone. An
AudioWorklet applies a modest two-semitone shift plus light EQ/compression and
publishes the resulting microphone track to LiveKit. The raw microphone is
unpublished while the effect is active and restored if processing or
publication fails. Voice sessions use the same server-calculated
reserve/settle/release credit windows as face processing, so plan entitlement,
wallet exhaustion and an admin voice-disable flag are enforced by the backend.

This is not voice cloning, a celebrity voice, or production-grade neural voice
conversion. Browsers without low-latency AudioWorklet support show a clear
warning and keep the original microphone.

## Device Guidance

Pricing and billing show practical Basic, Standard and Pro phone categories.
The optional device check examines logical cores, exposed memory, WebGL2,
WebGPU, a short FPS sample and, only with permission, camera resolution. Results
are `Excellent`, `Good`, `Fair`, or `Not recommended`.

The result is advisory and never blocks a user. Calls warn when background-tab
behavior or low battery can reduce processing stability. There is no standard
browser thermal sensor, so thermal throttling is inferred from frame pressure
and low-battery conditions rather than claimed as direct hardware telemetry.
