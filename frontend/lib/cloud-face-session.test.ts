import { describe, expect, it } from "vitest";
import {
  cloudFrameProfile,
  parseCloudFrameResponse,
} from "./cloud-face-session";
import { localBackendForCapabilities } from "./browser-face-session";

describe("cloud face frame policy", () => {
  it("keeps the HTTPS frame rate below the backend route limit", () => {
    expect(cloudFrameProfile("low")).toEqual({
      width: 640,
      height: 360,
      outputFps: 15,
      inferenceFps: 2,
      jpegQuality: 0.72,
    });
    expect(cloudFrameProfile("hd").inferenceFps).toBeLessThanOrEqual(2);
  });

  it("accepts only a valid processed image response", () => {
    const frame = "data:image/jpeg;base64,/9j/AA==";
    expect(
      parseCloudFrameResponse({
        processedFrame: frame,
        latencyMs: 120,
        providerStatus: "OPERATIONAL",
      }),
    ).toEqual({
      processedFrame: frame,
      latencyMs: 120,
      providerStatus: "OPERATIONAL",
    });
    expect(() =>
      parseCloudFrameResponse({
        processedFrame: "not-an-image",
        latencyMs: 120,
        providerStatus: "OPERATIONAL",
      }),
    ).toThrow("invalid processed frame");
  });
});

describe("local processing fallback", () => {
  it("selects browser acceleration without requiring cloud GPU", () => {
    expect(
      localBackendForCapabilities({
        webGpu: true,
        webGl: true,
        canvas2d: true,
      }),
    ).toBe("webgpu");
    expect(
      localBackendForCapabilities({
        webGpu: false,
        webGl: true,
        canvas2d: true,
      }),
    ).toBe("webgl");
    expect(
      localBackendForCapabilities({
        webGpu: false,
        webGl: false,
        canvas2d: true,
      }),
    ).toBe("canvas2d");
    expect(
      localBackendForCapabilities({
        webGpu: false,
        webGl: false,
        canvas2d: false,
      }),
    ).toBe("raw");
  });
});
