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

export interface CloudFrameProfile {
  maxLongEdge: number;
  outputFps: number;
  inferenceFps: number;
  encodeQuality: number;
  minEncodeQuality: number;
  maxUploadBytes: number;
  mimeTypes: readonly string[];
}

export interface EncodedCloudFrame {
  dataUrl: string;
  mimeType: string;
  byteLength: number;
}

const profiles = {
  low: {
    maxLongEdge: 640,
    outputFps: 18,
    inferenceFps: 6,
    encodeQuality: 0.88,
    minEncodeQuality: 0.78,
    maxUploadBytes: 4_000_000,
    mimeTypes: ["image/webp", "image/jpeg"],
  },
  standard: {
    maxLongEdge: 960,
    outputFps: 24,
    inferenceFps: 8,
    encodeQuality: 0.92,
    minEncodeQuality: 0.82,
    maxUploadBytes: 4_000_000,
    mimeTypes: ["image/webp", "image/jpeg"],
  },
  hd: {
    maxLongEdge: 1280,
    outputFps: 30,
    inferenceFps: 10,
    encodeQuality: 0.94,
    minEncodeQuality: 0.86,
    maxUploadBytes: 4_000_000,
    mimeTypes: ["image/webp", "image/jpeg"],
  },
} as const;

export function cloudFrameProfile(quality: FaceQuality): CloudFrameProfile {
  return profiles[quality];
}

export function cloudFrameDimensions(
  quality: FaceQuality,
  sourceWidth: number,
  sourceHeight: number,
) {
  const profile = cloudFrameProfile(quality);
  const width = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 16;
  const height =
    Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 9;
  const scale = Math.min(1, profile.maxLongEdge / Math.max(width, height));
  return {
    width: evenDimension(width * scale),
    height: evenDimension(height * scale),
  };
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
    const initial = cloudFrameDimensions(options.quality, 16, 9);
    this.canvas.width = initial.width;
    this.canvas.height = initial.height;
    this.captureCanvas.width = initial.width;
    this.captureCanvas.height = initial.height;
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
    this.resizeCanvasesToSource();
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
    this.resizeCanvasesToSource();
    const context = this.captureCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    } as CanvasRenderingContext2DSettings);
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
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const frame = await encodeCloudFrame(this.captureCanvas, profile);
      const raw = await apiFetch<unknown>("/ai/face/process-frame", {
        method: "POST",
        ...jsonBody({
          frame: frame.dataUrl,
          faceProfileId: this.options.faceProfileId,
          frameMetadata: {
            width: this.captureCanvas.width,
            height: this.captureCanvas.height,
            mimeType: frame.mimeType,
            byteLength: frame.byteLength,
          },
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
    const context = this.canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    } as CanvasRenderingContext2DSettings);
    if (!context) throw new Error("Cloud output canvas is unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawImageCover(context, image, this.canvas.width, this.canvas.height);
  }

  private resizeCanvasesToSource() {
    const next = cloudFrameDimensions(
      this.options.quality,
      this.video.videoWidth,
      this.video.videoHeight,
    );
    if (this.canvas.width !== next.width || this.canvas.height !== next.height) {
      this.canvas.width = next.width;
      this.canvas.height = next.height;
    }
    if (
      this.captureCanvas.width !== next.width ||
      this.captureCanvas.height !== next.height
    ) {
      this.captureCanvas.width = next.width;
      this.captureCanvas.height = next.height;
    }
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

function evenDimension(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

async function encodeCloudFrame(
  canvas: HTMLCanvasElement,
  profile: CloudFrameProfile,
): Promise<EncodedCloudFrame> {
  const qualities = [
    profile.encodeQuality,
    Math.max(profile.minEncodeQuality, profile.encodeQuality - 0.06),
    profile.minEncodeQuality,
  ];
  for (const mimeType of profile.mimeTypes) {
    if (!canvasSupportsMimeType(canvas, mimeType)) continue;
    for (const quality of qualities) {
      const encoded = await canvasToDataUrl(canvas, mimeType, quality);
      if (!encoded) continue;
      if (encoded.byteLength <= profile.maxUploadBytes) {
        return encoded;
      }
    }
  }
  const fallback = await canvasToDataUrl(
    canvas,
    "image/jpeg",
    profile.minEncodeQuality,
  );
  if (fallback && fallback.byteLength <= profile.maxUploadBytes) {
    return fallback;
  }
  throw new Error(
    "Cloud frame is too large to upload without visible compression. Lower video quality or improve lighting.",
  );
}

function canvasSupportsMimeType(canvas: HTMLCanvasElement, mimeType: string) {
  if (mimeType === "image/jpeg") return true;
  try {
    return canvas.toDataURL(mimeType, 0.8).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}

async function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<EncodedCloudFrame | null> {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality),
    );
    if (blob?.type === mimeType) {
      return {
        dataUrl: await blobToDataUrl(blob),
        mimeType,
        byteLength: blob.size,
      };
    }
  }
  const dataUrl = canvas.toDataURL(mimeType, quality);
  if (!dataUrl.startsWith(`data:${mimeType}`)) return null;
  return {
    dataUrl,
    mimeType,
    byteLength: dataUrlByteLength(dataUrl),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Frame encoding failed"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlByteLength(dataUrl: string) {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
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
