"use client";
import { apiFetch, jsonBody } from "./api";

export type FaceQuality = "low" | "standard" | "hd";

export interface CloudFrameResponse {
  processedFrame: string;
  latencyMs: number;
  providerStatus: string;
}

export interface CloudFaceSessionOptions {
  sourceTrack: MediaStreamTrack;
  faceProfileId: string;
  roomId: string;
  quality: FaceQuality;
  onTrackingState(state: "tracking" | "degraded" | "paused"): void;
  onFrameTime(milliseconds: number): void;
  onProviderFailure(message: string): void;
}

const profiles = {
  low: {
    width: 640,
    height: 360,
    outputFps: 15,
    inferenceFps: 2,
    jpegQuality: 0.72,
  },
  standard: {
    width: 854,
    height: 480,
    outputFps: 24,
    inferenceFps: 2,
    jpegQuality: 0.78,
  },
  hd: {
    width: 1280,
    height: 720,
    outputFps: 30,
    inferenceFps: 2,
    jpegQuality: 0.82,
  },
} as const;

export function cloudFrameProfile(quality: FaceQuality) {
  return profiles[quality];
}

export function parseCloudFrameResponse(value: unknown): CloudFrameResponse {
  const candidate = value as Partial<CloudFrameResponse> | null;
  if (
    !candidate ||
    typeof candidate.processedFrame !== "string" ||
    !/^data:image\/(jpeg|png|webp);base64,/i.test(candidate.processedFrame)
  ) {
    throw new Error("Cloud provider returned an invalid processed frame");
  }
  if (
    typeof candidate.latencyMs !== "number" ||
    !Number.isFinite(candidate.latencyMs) ||
    typeof candidate.providerStatus !== "string"
  ) {
    throw new Error("Cloud provider returned invalid frame metadata");
  }
  return {
    processedFrame: candidate.processedFrame,
    latencyMs: candidate.latencyMs,
    providerStatus: candidate.providerStatus,
  };
}

export class CloudFaceSession {
  readonly canvas = document.createElement("canvas");
  readonly video = document.createElement("video");
  private readonly captureCanvas = document.createElement("canvas");
  private outputTrack: MediaStreamTrack | null = null;
  private inferenceTimer = 0;
  private running = false;
  private consecutiveFailures = 0;
  private requestInFlight = false;

  constructor(private readonly options: CloudFaceSessionOptions) {
    const profile = cloudFrameProfile(options.quality);
    this.canvas.width = profile.width;
    this.canvas.height = profile.height;
    this.captureCanvas.width = profile.width;
    this.captureCanvas.height = profile.height;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([options.sourceTrack]);
  }

  async start(): Promise<MediaStreamTrack> {
    if (typeof this.canvas.captureStream !== "function") {
      throw new Error("Cloud canvas video is not supported by this browser");
    }
    await this.video.play();
    await waitForVideo(this.video);
    this.running = true;
    this.drawStatus("Connecting to secure cloud face processing…");
    try {
      await this.processNextFrame();
    } catch (error) {
      this.stop();
      throw error;
    }
    const profile = cloudFrameProfile(this.options.quality);
    const track = this.canvas.captureStream(profile.outputFps).getVideoTracks()[0];
    if (!track) {
      this.stop();
      throw new Error("Cloud processed canvas track is unavailable");
    }
    this.outputTrack = track;
    this.scheduleNextFrame();
    return track;
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.inferenceTimer);
    this.outputTrack?.stop();
    this.outputTrack = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private scheduleNextFrame() {
    if (!this.running) return;
    const interval = 1000 / cloudFrameProfile(this.options.quality).inferenceFps;
    this.inferenceTimer = window.setTimeout(() => {
      void this.processNextFrame()
        .catch((error) => this.handleFailure(error))
        .finally(() => this.scheduleNextFrame());
    }, interval);
  }

  private async processNextFrame() {
    if (!this.running || this.requestInFlight) return;
    const context = this.captureCanvas.getContext("2d");
    if (!context) throw new Error("Cloud frame capture is unavailable");
    this.requestInFlight = true;
    const startedAt = performance.now();
    try {
      context.drawImage(
        this.video,
        0,
        0,
        this.captureCanvas.width,
        this.captureCanvas.height,
      );
      const profile = cloudFrameProfile(this.options.quality);
      const frame = this.captureCanvas.toDataURL("image/jpeg", profile.jpegQuality);
      const raw = await apiFetch<unknown>("/ai/face/process-frame", {
        method: "POST",
        ...jsonBody({
          frame,
          faceProfileId: this.options.faceProfileId,
          qualityMode: this.options.quality,
          roomId: this.options.roomId,
        }),
      });
      const result = parseCloudFrameResponse(raw);
      await this.drawProcessedFrame(result.processedFrame);
      this.consecutiveFailures = 0;
      this.options.onTrackingState("tracking");
      this.options.onFrameTime(
        Math.max(result.latencyMs, performance.now() - startedAt),
      );
    } finally {
      this.requestInFlight = false;
    }
  }

  private async drawProcessedFrame(frame: string) {
    const image = new Image();
    image.decoding = "async";
    image.src = frame;
    await image.decode();
    if (!this.running) return;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Cloud output canvas is unavailable");
    context.save();
    context.scale(-1, 1);
    context.drawImage(
      image,
      -this.canvas.width,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    context.restore();
  }

  private handleFailure(error: unknown) {
    this.consecutiveFailures += 1;
    this.options.onTrackingState(
      this.consecutiveFailures >= 3 ? "paused" : "degraded",
    );
    if (this.consecutiveFailures >= 3) {
      this.drawStatus("Cloud processing paused. Switching to local mode…");
      this.running = false;
      this.options.onProviderFailure(
        error instanceof Error
          ? error.message
          : "Cloud face processing became unavailable",
      );
    }
  }

  private drawStatus(message: string) {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#07111f";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = "white";
    context.font = "600 18px system-ui";
    context.textAlign = "center";
    context.fillText(message, this.canvas.width / 2, this.canvas.height / 2);
  }
}

async function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Camera did not provide a frame for cloud processing")),
      5_000,
    );
    video.addEventListener(
      "loadeddata",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
