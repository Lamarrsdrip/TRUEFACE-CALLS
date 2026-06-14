import { describe, expect, it } from "vitest";
import { rateDevice } from "./device-capabilities";

describe("device capability rating", () => {
  it("rates a strong WebGPU device excellent", () => {
    expect(
      rateDevice({
        logicalCores: 8,
        memoryGb: 8,
        webgl2: true,
        webgpu: true,
        benchmarkFps: 58,
        cameraHeight: 1080,
      }).rating,
    ).toBe("Excellent");
  });

  it("warns rather than blocking a weak device", () => {
    const result = rateDevice({
      logicalCores: 2,
      memoryGb: 2,
      webgl2: false,
      webgpu: false,
      benchmarkFps: 18,
      cameraHeight: 480,
    });
    expect(result.rating).toBe("Not recommended");
    expect(result.blocked).toBe(false);
  });
});
