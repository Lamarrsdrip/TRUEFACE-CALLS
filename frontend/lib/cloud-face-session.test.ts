import { describe, expect, it } from "vitest";
import {
  cloudFrameProfile,
  cloudFrameDimensions,
  parseCloudFrameResponse,
} from "./cloud-face-session";
import { localBackendForCapabilities } from "./browser-face-session";

describe("cloud face frame policy", () => {
  it("uses high-detail cloud frames instead of low-rate compressed thumbnails", () => {
    expect(cloudFrameProfile("low")).toMatchObject({
      maxLongEdge: 640,
      outputFps: 18,
      inferenceFps: 6,
      encodeQuality: 0.88,
    });
    expect(cloudFrameProfile("standard")).toMatchObject({
      maxLongEdge: 960,
      outputFps: 24,
      inferenceFps: 8,
      encodeQuality: 0.92,
    });
    expect(cloudFrameProfile("hd")).toMatchObject({
      maxLongEdge: 1280,
      outputFps: 30,
      inferenceFps: 10,
      encodeQuality: 0.94,
    });
    expect(cloudFrameProfile("hd").mimeTypes).toContain("image/webp");
  });

  it("preserves portrait and landscape camera aspect ratios", () => {
    expect(cloudFrameDimensions("standard", 1920, 1080)).toEqual({
      width: 960,
      height: 540,
    });
    expect(cloudFrameDimensions("standard", 1080, 1920)).toEqual({
      width: 540,
      height: 960,
    });
    expect(cloudFrameDimensions("hd", 720, 1280)).toEqual({
      width: 720,
      height: 1280,
    });
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
