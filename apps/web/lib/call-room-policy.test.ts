import { describe, expect, it } from "vitest";
import {
  getJoinButtonLabel,
  isJoinButtonDisabled,
  shouldShowGuestNameField,
  shouldShowHostControls,
} from "./call-room-policy";

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
