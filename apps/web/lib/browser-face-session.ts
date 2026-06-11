"use client";

import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { TrackingStateMachine } from "@trueface/media-engine";

export interface BrowserFaceSessionOptions {
  sourceTrack: MediaStreamTrack;
  faceImageUrl: string;
  quality: "low" | "standard" | "hd";
  onTrackingState(state: "tracking" | "degraded" | "paused"): void;
  onFrameTime(milliseconds: number): void;
}

const profiles = {
  low: { width: 640, height: 360, fps: 15 },
  standard: { width: 854, height: 480, fps: 24 },
  hd: { width: 1280, height: 720, fps: 30 },
};

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
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
    );
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
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
        "AI face paused — tracking lost",
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
    const width = (maxX - minX) * this.canvas.width * 1.34;
    const height = (maxY - minY) * this.canvas.height * (1.42 + jawOpen * 0.08);
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const angle =
      leftEye && rightEye
        ? Math.atan2(rightEye.y - leftEye.y, 1 - rightEye.x - (1 - leftEye.x))
        : 0;

    context.save();
    context.translate(centerX, centerY);
    context.rotate(angle);
    context.beginPath();
    context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.clip();
    context.globalAlpha = state === "degraded" ? 0.82 : 0.96;
    context.filter = "saturate(0.94) contrast(1.03) brightness(1.02)";
    context.drawImage(this.faceImage!, -width / 2, -height / 2, width, height);
    context.filter = "none";
    context.globalCompositeOperation = "soft-light";
    const lighting = context.createRadialGradient(
      -width * 0.18,
      -height * 0.2,
      0,
      0,
      0,
      width,
    );
    lighting.addColorStop(0, "rgba(255,255,255,0.18)");
    lighting.addColorStop(1, "rgba(0,0,0,0.18)");
    context.fillStyle = lighting;
    context.fillRect(-width / 2, -height / 2, width, height);
    context.restore();
  }
}
