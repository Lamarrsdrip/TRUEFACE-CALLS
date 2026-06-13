"use client";

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface FaceQualityAnalysis {
  width: number;
  height: number;
  faceCount: number;
  blurScore: number;
  brightness: number;
  faceCoverage: number;
}

export async function analyzeFaceImage(
  file: File,
): Promise<FaceQualityAnalysis> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("Canvas image analysis is unavailable");
  }
  context.drawImage(bitmap, 0, 0);

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
  );
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "IMAGE",
    numFaces: 2,
    outputFaceBlendshapes: true,
  });

  const result = landmarker.detect(bitmap);
  const landmarks = result.faceLandmarks[0] ?? [];
  const faceCoverage = landmarks.length > 0 ? landmarkCoverage(landmarks) : 0;
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const brightness = meanBrightness(pixels.data);
  const blurScore = normalizedSharpness(
    pixels.data,
    bitmap.width,
    bitmap.height,
  );

  landmarker.close();
  bitmap.close();
  return {
    width: canvas.width,
    height: canvas.height,
    faceCount: result.faceLandmarks.length,
    blurScore,
    brightness,
    faceCoverage,
  };
}

function landmarkCoverage(landmarks: Array<{ x: number; y: number }>): number {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(0, (maxX - minX) * (maxY - minY));
}

function meanBrightness(data: Uint8ClampedArray): number {
  let total = 0;
  let samples = 0;
  for (let index = 0; index < data.length; index += 4 * 16) {
    total +=
      (0.2126 * (data[index] ?? 0) +
        0.7152 * (data[index + 1] ?? 0) +
        0.0722 * (data[index + 2] ?? 0)) /
      255;
    samples += 1;
  }
  return samples === 0 ? 0 : total / samples;
}

function normalizedSharpness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 160));
  let total = 0;
  let samples = 0;
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const center = luminanceAt(data, width, x, y);
      const laplacian =
        4 * center -
        luminanceAt(data, width, x - step, y) -
        luminanceAt(data, width, x + step, y) -
        luminanceAt(data, width, x, y - step) -
        luminanceAt(data, width, x, y + step);
      total += laplacian * laplacian;
      samples += 1;
    }
  }
  const variance = samples === 0 ? 0 : total / samples;
  return Math.min(1, variance / 1_400);
}

function luminanceAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
) {
  const index = (y * width + x) * 4;
  return (
    (0.2126 * (data[index] ?? 0) +
      0.7152 * (data[index + 1] ?? 0) +
      0.0722 * (data[index + 2] ?? 0)) /
    255
  );
}
