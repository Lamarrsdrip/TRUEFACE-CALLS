import type { QualityProfile } from "@trueface/contracts";

export type TrackingState = "tracking" | "degraded" | "paused";

export interface TrackingStateOptions {
  lostFrameThreshold: number;
  recoveryFrameThreshold: number;
  minimumConfidence: number;
}

export class TrackingStateMachine {
  private lostFrames = 0;
  private recoveredFrames = 0;
  private state: TrackingState = "tracking";

  constructor(private readonly options: TrackingStateOptions) {}

  update(confidence: number): TrackingState {
    if (confidence < this.options.minimumConfidence) {
      this.recoveredFrames = 0;
      this.lostFrames += 1;

      if (this.lostFrames >= this.options.lostFrameThreshold) {
        this.state = "paused";
      } else {
        this.state = "degraded";
      }

      return this.state;
    }

    this.lostFrames = 0;

    if (this.state === "paused") {
      this.recoveredFrames += 1;
      if (this.recoveredFrames >= this.options.recoveryFrameThreshold) {
        this.recoveredFrames = 0;
        this.state = "tracking";
      }
      return this.state;
    }

    this.recoveredFrames = 0;
    this.state = "tracking";
    return this.state;
  }
}

export interface PublicationPort {
  unpublishRawCamera(): Promise<void>;
  publishProcessedTrack(track: MediaStreamTrack): Promise<void>;
  publishAiDisclosure(active: boolean): Promise<void>;
  stopProcessedTrack(track: MediaStreamTrack): void;
  requestRawCameraRestore?(): void;
}

export class AiPublicationCoordinator {
  private activeTrack: MediaStreamTrack | null = null;

  constructor(private readonly port: PublicationPort) {}

  async enable(track: MediaStreamTrack): Promise<void> {
    await this.port.unpublishRawCamera();

    try {
      await this.port.publishProcessedTrack(track);
      this.activeTrack = track;
      await this.port.publishAiDisclosure(true);
    } catch (error) {
      this.port.stopProcessedTrack(track);
      this.port.requestRawCameraRestore?.();
      throw error;
    }
  }

  async disable(): Promise<void> {
    if (this.activeTrack) {
      this.port.stopProcessedTrack(this.activeTrack);
      this.activeTrack = null;
    }
    await this.port.publishAiDisclosure(false);
  }
}

export interface FrameMetrics {
  renderTimeMs: number;
  trackingConfidence: number;
  droppedFrames: number;
}

export function shouldDegradeQuality(input: {
  profile: QualityProfile;
  recentFrames: FrameMetrics[];
}): boolean {
  if (input.recentFrames.length < 10) {
    return false;
  }

  const frameBudget = 1000 / input.profile.targetFps;
  const overBudget = input.recentFrames.filter(
    (frame) => frame.renderTimeMs > frameBudget * 1.25,
  ).length;
  const lowConfidence = input.recentFrames.filter(
    (frame) => frame.trackingConfidence < 0.65,
  ).length;

  return (
    overBudget / input.recentFrames.length >= 0.4 ||
    lowConfidence / input.recentFrames.length >= 0.5
  );
}

export interface CompositorOptions {
  width: number;
  height: number;
  fps: number;
}

export function createProcessedCanvasTrack(
  canvas: HTMLCanvasElement,
  options: CompositorOptions,
): MediaStreamTrack {
  canvas.width = options.width;
  canvas.height = options.height;
  const stream = canvas.captureStream(options.fps);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new Error("Canvas capture did not produce a video track");
  }
  return track;
}

export interface FaceFrame {
  confidence: number;
  landmarks: Array<{ x: number; y: number; z: number }>;
  blendshapes: Record<string, number>;
  poseMatrix?: number[];
}

export interface FaceTracker {
  initialize(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): FaceFrame | null;
  close(): void;
}

export interface FaceRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>;
  render(input: {
    video: HTMLVideoElement;
    face: FaceFrame;
    faceImage: ImageBitmap;
    lowLight: boolean;
  }): void;
  renderPaused(reason: string): void;
  close(): void;
}
