import { describe, expect, it, vi } from "vitest";
import { AiPublicationCoordinator, TrackingStateMachine } from "./index.js";

describe("AI publication coordinator", () => {
  it("unpublishes the raw camera before publishing processed video", async () => {
    const events: string[] = [];
    const coordinator = new AiPublicationCoordinator({
      unpublishRawCamera: vi.fn(async () => {
        events.push("raw-unpublished");
      }),
      publishProcessedTrack: vi.fn(async () => {
        events.push("processed-published");
      }),
      publishAiDisclosure: vi.fn(async () => {
        events.push("disclosure-published");
      }),
      stopProcessedTrack: vi.fn(),
    });

    await coordinator.enable({ id: "processed-track" } as MediaStreamTrack);

    expect(events).toEqual([
      "raw-unpublished",
      "processed-published",
      "disclosure-published",
    ]);
  });

  it("keeps the raw camera unpublished when processed publication fails", async () => {
    const restore = vi.fn();
    const coordinator = new AiPublicationCoordinator({
      unpublishRawCamera: vi.fn(),
      publishProcessedTrack: vi.fn(async () => {
        throw new Error("publish failed");
      }),
      publishAiDisclosure: vi.fn(),
      stopProcessedTrack: vi.fn(),
      requestRawCameraRestore: restore,
    });

    await expect(
      coordinator.enable({ id: "processed-track" } as MediaStreamTrack),
    ).rejects.toThrow("publish failed");
    expect(restore).toHaveBeenCalledTimes(1);
  });
});

describe("tracking state machine", () => {
  it("pauses after sustained low-confidence tracking", () => {
    const machine = new TrackingStateMachine({
      lostFrameThreshold: 3,
      recoveryFrameThreshold: 2,
      minimumConfidence: 0.65,
    });

    expect(machine.update(0.4)).toBe("degraded");
    expect(machine.update(0.4)).toBe("degraded");
    expect(machine.update(0.4)).toBe("paused");
    expect(machine.update(0.9)).toBe("paused");
    expect(machine.update(0.9)).toBe("tracking");
  });
});
