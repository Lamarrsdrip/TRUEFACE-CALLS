"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { TrackingStateMachine } from "./media-engine";

export interface BrowserFaceSessionOptions {
  sourceTrack: MediaStreamTrack;
  faceImageUrl: string;
  quality: "low" | "standard" | "hd";
  onTrackingState(state: "tracking" | "degraded" | "paused"): void;
  onFrameTime(milliseconds: number): void;
  onBackend?(backend: LocalProcessingBackend): void;
}

export type LocalProcessingBackend = "webgpu" | "webgl" | "canvas2d" | "raw";

export function localBackendForCapabilities(capabilities: {
  webGpu: boolean;
  webGl: boolean;
  canvas2d: boolean;
}): LocalProcessingBackend {
  if (capabilities.webGpu) return "webgpu";
  if (capabilities.webGl) return "webgl";
  if (capabilities.canvas2d) return "canvas2d";
  return "raw";
}

const profiles = {
  low: { width: 640, height: 360, fps: 15 },
  standard: { width: 854, height: 480, fps: 24 },
  hd: { width: 1280, height: 720, fps: 30 },
};

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

export class BrowserFaceSession {
  readonly canvas = document.createElement("canvas");
  readonly video = document.createElement("video");
  private landmarker: FaceLandmarker | null = null;
  private faceImage: ImageBitmap | null = null;
  private outputTrack: MediaStreamTrack | null = null;
  private frameRequest = 0;
  private running = false;
  private lastFrameAt = 0;
  private tracking = new TrackingStateMachine({
    lostFrameThreshold: 10,
    recoveryFrameThreshold: 4,
    minimumConfidence: 0.62,
  });
  private smoothed = { centerX: 0, centerY: 0, width: 0, height: 0, angle: 0 };

  constructor(private readonly options: BrowserFaceSessionOptions) {
    const profile = profiles[options.quality];
    this.canvas.width = profile.width;
    this.canvas.height = profile.height;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([options.sourceTrack]);
  }

  async start(): Promise<MediaStreamTrack> {
    await this.video.play();
    const capabilityCanvas = document.createElement("canvas");
    const backend = localBackendForCapabilities({
      webGpu:
        typeof navigator !== "undefined" &&
        "gpu" in (navigator as Navigator & { gpu?: unknown }),
      webGl: Boolean(
        capabilityCanvas.getContext("webgl2") ||
          capabilityCanvas.getContext("webgl"),
      ),
      canvas2d: Boolean(this.canvas.getContext("2d")),
    });
    if (backend === "raw") {
      throw new Error(
        "This browser cannot create a processed local video canvas",
      );
    }
    this.options.onBackend?.(backend);
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
    );
    const options = {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    } as const;
    if (backend === "webgpu" || backend === "webgl") {
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: {
            ...options.baseOptions,
            delegate: "GPU",
          },
        });
      } catch {
        this.options.onBackend?.("canvas2d");
      }
    }
    if (!this.landmarker) {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, options);
    }
    const response = await fetch(this.options.faceImageUrl, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Approved face image could not be loaded");
    }
    this.faceImage = await createImageBitmap(await response.blob());
    this.running = true;
    this.renderFrame();
    const profile = profiles[this.options.quality];
    const track = this.canvas.captureStream(profile.fps).getVideoTracks()[0];
    if (!track) {
      throw new Error("Processed canvas track is unavailable");
    }
    this.outputTrack = track;
    return track;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.outputTrack?.stop();
    this.outputTrack = null;
    this.faceImage?.close();
    this.faceImage = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private renderFrame = () => {
    if (!this.running || !this.landmarker || !this.faceImage) return;
    const now = performance.now();
    const targetInterval = 1000 / profiles[this.options.quality].fps;
    if (now - this.lastFrameAt < targetInterval) {
      this.frameRequest = requestAnimationFrame(this.renderFrame);
      return;
    }
    this.lastFrameAt = now;
    const startedAt = performance.now();
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.scale(-1, 1);
    context.drawImage(
      this.video,
      -this.canvas.width,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    context.restore();

    const result = this.landmarker.detectForVideo(this.video, now);
    const landmarks = result.faceLandmarks[0];
    const confidence = landmarks ? 0.95 : 0;
    const state = this.tracking.update(confidence);
    this.options.onTrackingState(state);

    if (landmarks && state !== "paused") {
      const blendshapes =
        result.faceBlendshapes[0]?.categories.reduce<Record<string, number>>(
          (map, category) => {
            map[category.categoryName] = category.score;
            return map;
          },
          {},
        ) ?? {};
      this.drawReplacement(context, landmarks, blendshapes, state);
    } else if (state === "paused") {
      context.fillStyle = "rgba(7, 17, 31, 0.72)";
      context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      context.fillStyle = "white";
      context.font = "600 18px system-ui";
      context.textAlign = "center";
      context.fillText(
        "Local face mask paused - tracking lost",
        this.canvas.width / 2,
        this.canvas.height / 2,
      );
    }

    this.options.onFrameTime(performance.now() - startedAt);
    this.frameRequest = requestAnimationFrame(this.renderFrame);
  };

  private drawReplacement(
    context: CanvasRenderingContext2D,
    landmarks: NormalizedLandmark[],
    blendshapes: Record<string, number>,
    state: "tracking" | "degraded",
  ) {
    const xs = landmarks.map((point) => 1 - point.x);
    const ys = landmarks.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = ((minX + maxX) / 2) * this.canvas.width;
    const centerY = ((minY + maxY) / 2) * this.canvas.height;
    const jawOpen = blendshapes.jawOpen ?? 0;
    const width = (maxX - minX) * this.canvas.width * 1.3;
    const height = (maxY - minY) * this.canvas.height * (1.38 + jawOpen * 0.12);
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const angle =
      leftEye && rightEye
        ? Math.atan2(rightEye.y - leftEye.y, 1 - rightEye.x - (1 - leftEye.x))
        : 0;
    const smoothing = state === "degraded" ? 0.08 : 0.22;
    const previous = this.smoothed;
    const next = {
      centerX: previous.width
        ? previous.centerX + (centerX - previous.centerX) * smoothing
        : centerX,
      centerY: previous.height
        ? previous.centerY + (centerY - previous.centerY) * smoothing
        : centerY,
      width: previous.width
        ? previous.width + (width - previous.width) * smoothing
        : width,
      height: previous.height
        ? previous.height + (height - previous.height) * smoothing
        : height,
      angle: previous.width
        ? previous.angle + (angle - previous.angle) * smoothing
        : angle,
    };
    this.smoothed = next;

    context.save();
    context.translate(next.centerX, next.centerY);
    context.rotate(next.angle);
    context.beginPath();
    FACE_OVAL.forEach((index, position) => {
      const point = landmarks[index];
      const x = (1 - point.x) * this.canvas.width - next.centerX;
      const y = point.y * this.canvas.height - next.centerY;
      if (position === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.clip();
    context.globalAlpha = state === "degraded" ? 0.82 : 0.96;
    context.filter =
      state === "degraded"
        ? "blur(1.2px) saturate(0.9) contrast(1.02)"
        : "saturate(0.94) contrast(1.04) brightness(1.01)";
    context.drawImage(
      this.faceImage!,
      -next.width / 2,
      -next.height / 2,
      next.width,
      next.height,
    );
    context.filter = "none";
    context.globalCompositeOperation = "soft-light";
    const lighting = context.createRadialGradient(
      -next.width * 0.18,
      -next.height * 0.2,
      0,
      0,
      0,
      next.width,
    );
    lighting.addColorStop(0, "rgba(255,255,255,0.18)");
    lighting.addColorStop(1, "rgba(0,0,0,0.18)");
    context.fillStyle = lighting;
    context.fillRect(
      -next.width / 2,
      -next.height / 2,
      next.width,
      next.height,
    );
    context.restore();

    // A soft contour hides hard mask edges while retaining the live camera
    // underneath. Blink and jaw blendshapes influence opacity and geometry,
    // but this local mode remains an enhanced mask rather than neural swap.
    const blink =
      ((blendshapes.eyeBlinkLeft ?? 0) + (blendshapes.eyeBlinkRight ?? 0)) / 2;
    context.save();
    context.globalAlpha = 0.08 + Math.min(0.08, blink * 0.08);
    context.filter = "blur(8px)";
    context.strokeStyle = "rgba(20, 20, 24, 0.55)";
    context.lineWidth = Math.max(6, next.width * 0.035);
    context.beginPath();
    FACE_OVAL.forEach((index, position) => {
      const point = landmarks[index];
      const x = (1 - point.x) * this.canvas.width;
      const y = point.y * this.canvas.height;
      if (position === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.stroke();
    context.restore();
  }
}
