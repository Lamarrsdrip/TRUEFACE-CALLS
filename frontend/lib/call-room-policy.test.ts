import { describe, expect, it } from "vitest";
import {
  getJoinButtonLabel,
  isJoinButtonDisabled,
  shouldShowGuestNameField,
  shouldShowHostControls,
} from "./call-room-policy";
import {
  AiPublicationCoordinator,
  replacePublishedTrack,
} from "./media-engine";

describe("call room preflight policy", () => {
  it("lets a host enter without typing a guest name", () => {
    expect(
      isJoinButtonDisabled({
        busy: false,
        allowGuests: true,
        isHostIntent: true,
        guestName: "",
      }),
    ).toBe(false);
    expect(
      shouldShowGuestNameField({ allowGuests: true, isHostIntent: true }),
    ).toBe(false);
    expect(getJoinButtonLabel({ isHostIntent: true, busy: false })).toBe(
      "Enter host room",
    );
  });

  it("still requires a visible name for browser guests when guests are allowed", () => {
    expect(
      isJoinButtonDisabled({
        busy: false,
        allowGuests: true,
        isHostIntent: false,
        guestName: "",
      }),
    ).toBe(true);
    expect(
      isJoinButtonDisabled({
        busy: false,
        allowGuests: true,
        isHostIntent: false,
        guestName: "Ada",
      }),
    ).toBe(false);
  });

  it("shows host controls only for local host participants", () => {
    expect(shouldShowHostControls({ localRole: "HOST" })).toBe(true);
    expect(shouldShowHostControls({ localRole: "PARTICIPANT" })).toBe(false);
    expect(shouldShowHostControls({ localRole: null })).toBe(false);
  });
});

describe("processed LiveKit publication", () => {
  it("publishes the processed track after unpublishing the raw camera", async () => {
    const calls: string[] = [];
    const track = { stop() {} } as unknown as MediaStreamTrack;
    const coordinator = new AiPublicationCoordinator({
      async unpublishRawCamera() {
        calls.push("unpublish");
      },
      async publishProcessedTrack() {
        calls.push("publish-processed");
      },
      async publishAiDisclosure(active) {
        calls.push(`disclosure-${active}`);
      },
      stopProcessedTrack() {},
    });

    await coordinator.enable(track);
    expect(calls).toEqual([
      "unpublish",
      "publish-processed",
      "disclosure-true",
    ]);
  });

  it("restores the original camera when processed publication fails", async () => {
    let restored = false;
    const track = { stop() {} } as unknown as MediaStreamTrack;
    const coordinator = new AiPublicationCoordinator({
      async unpublishRawCamera() {},
      async publishProcessedTrack() {
        throw new Error("publish failed");
      },
      async publishAiDisclosure() {},
      stopProcessedTrack() {},
      async restoreRawCamera() {
        restored = true;
      },
    });

    await expect(coordinator.enable(track)).rejects.toThrow("publish failed");
    expect(restored).toBe(true);
  });

  it("publishes processed audio and restores the microphone on failure", async () => {
    const calls: string[] = [];
    await expect(
      replacePublishedTrack({
        async unpublishOriginal() {
          calls.push("unpublish-mic");
        },
        async publishProcessed() {
          calls.push("publish-voice");
          throw new Error("voice publish failed");
        },
        async restoreOriginal() {
          calls.push("restore-mic");
        },
      }),
    ).rejects.toThrow("voice publish failed");
    expect(calls).toEqual([
      "unpublish-mic",
      "publish-voice",
      "restore-mic",
    ]);
  });
});
