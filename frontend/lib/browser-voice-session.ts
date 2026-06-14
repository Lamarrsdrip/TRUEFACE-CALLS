export type VoicePreference = "MALE_TONE" | "FEMALE_TONE" | "ORIGINAL";

export function semitonesForPreference(preference: VoicePreference) {
  if (preference === "MALE_TONE") return -2;
  if (preference === "FEMALE_TONE") return 2;
  return 0;
}

export function browserVoiceSupport(input?: {
  AudioContext: unknown;
  MediaStream: unknown;
  audioWorklet: boolean;
}) {
  const AudioContextConstructor =
    input?.AudioContext ??
    (typeof window !== "undefined"
      ? window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined);
  const MediaStreamConstructor =
    input?.MediaStream ??
    (typeof window !== "undefined" ? window.MediaStream : undefined);
  const audioWorklet =
    input?.audioWorklet ??
    (typeof AudioWorkletNode !== "undefined" && Boolean(AudioContextConstructor));
  if (!AudioContextConstructor || !MediaStreamConstructor || !audioWorklet) {
    return {
      supported: false,
      reason: "This browser does not support low-latency AudioWorklet processing.",
    };
  }
  return { supported: true, reason: null };
}

export class BrowserVoiceSession {
  private context: AudioContext | null = null;
  private outputTrack: MediaStreamTrack | null = null;

  constructor(
    private readonly sourceTrack: MediaStreamTrack,
    private readonly preference: VoicePreference,
  ) {}

  async start(): Promise<MediaStreamTrack> {
    const support = browserVoiceSupport();
    if (!support.supported) throw new Error(support.reason ?? "Voice processing unavailable");
    const Context =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) throw new Error("AudioContext is unavailable");
    const context = new Context({ latencyHint: "interactive" });
    await context.audioWorklet.addModule("/audio/voice-tone-processor.js");
    const source = context.createMediaStreamSource(
      new MediaStream([this.sourceTrack]),
    );
    const processor = new AudioWorkletNode(context, "trueface-voice-tone", {
      channelCount: 1,
      channelCountMode: "explicit",
      outputChannelCount: [1],
    });
    processor.parameters
      .get("semitones")
      ?.setValueAtTime(semitonesForPreference(this.preference), context.currentTime);
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = this.preference === "MALE_TONE" ? 240 : 2800;
    filter.Q.value = 0.7;
    filter.gain.value = this.preference === "ORIGINAL" ? 0 : 2.5;
    const compressor = context.createDynamicsCompressor();
    const destination = context.createMediaStreamDestination();
    source.connect(processor).connect(filter).connect(compressor).connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      await context.close();
      throw new Error("Processed microphone track is unavailable");
    }
    this.context = context;
    this.outputTrack = track;
    return track;
  }

  async stop() {
    this.outputTrack?.stop();
    this.outputTrack = null;
    await this.context?.close();
    this.context = null;
  }
}
