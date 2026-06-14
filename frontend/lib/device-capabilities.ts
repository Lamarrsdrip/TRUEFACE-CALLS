export type DeviceRating = "Excellent" | "Good" | "Fair" | "Not recommended";

export interface DeviceSignals {
  logicalCores: number;
  memoryGb: number | null;
  webgl2: boolean;
  webgpu: boolean;
  benchmarkFps: number;
  cameraHeight: number | null;
}

export function rateDevice(signals: DeviceSignals): {
  rating: DeviceRating;
  blocked: false;
  recommendedQuality: "low" | "standard" | "hd";
  warnings: string[];
} {
  let score = 0;
  if (signals.logicalCores >= 8) score += 2;
  else if (signals.logicalCores >= 4) score += 1;
  if ((signals.memoryGb ?? 4) >= 8) score += 2;
  else if ((signals.memoryGb ?? 4) >= 4) score += 1;
  if (signals.webgpu) score += 2;
  else if (signals.webgl2) score += 1;
  if (signals.benchmarkFps >= 50) score += 2;
  else if (signals.benchmarkFps >= 28) score += 1;
  if ((signals.cameraHeight ?? 720) >= 720) score += 1;

  const rating: DeviceRating =
    score >= 8
      ? "Excellent"
      : score >= 5
        ? "Good"
        : score >= 3
          ? "Fair"
          : "Not recommended";
  const warnings: string[] = [];
  if (!signals.webgl2) warnings.push("WebGL2 is unavailable; local effects may be slow.");
  if (signals.benchmarkFps < 28) warnings.push("The short FPS check was below 28 FPS.");
  if (signals.logicalCores < 4) warnings.push("This device reports fewer than four logical CPU cores.");
  return {
    rating,
    blocked: false,
    recommendedQuality:
      rating === "Excellent" ? "hd" : rating === "Good" ? "standard" : "low",
    warnings,
  };
}

export async function inspectDevice(
  includeCamera = false,
): Promise<ReturnType<typeof rateDevice> & { signals: DeviceSignals }> {
  const canvas = document.createElement("canvas");
  const webgl2 = Boolean(canvas.getContext("webgl2"));
  const webgpu = "gpu" in navigator;
  const started = performance.now();
  let frames = 0;
  while (performance.now() - started < 500) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    frames += 1;
  }
  let cameraHeight: number | null = null;
  if (includeCamera) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    cameraHeight = stream.getVideoTracks()[0]?.getSettings().height ?? null;
    stream.getTracks().forEach((track) => track.stop());
  }
  const memory =
    "deviceMemory" in navigator
      ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
      : null;
  const signals: DeviceSignals = {
    logicalCores: navigator.hardwareConcurrency || 2,
    memoryGb: Number.isFinite(memory) ? memory : null,
    webgl2,
    webgpu,
    benchmarkFps: Math.round(frames * 2),
    cameraHeight,
  };
  return { ...rateDevice(signals), signals };
}
