import { describe, expect, it } from "vitest";
import {
  browserVoiceSupport,
  semitonesForPreference,
} from "./browser-voice-session";

describe("browser voice processing", () => {
  it("uses modest non-impersonation tone shifts", () => {
    expect(semitonesForPreference("MALE_TONE")).toBe(-2);
    expect(semitonesForPreference("FEMALE_TONE")).toBe(2);
    expect(semitonesForPreference("ORIGINAL")).toBe(0);
  });

  it("reports AudioWorklet support accurately", () => {
    expect(
      browserVoiceSupport({
        AudioContext: class {},
        MediaStream: class {},
        audioWorklet: true,
      }),
    ).toEqual({ supported: true, reason: null });
    expect(
      browserVoiceSupport({
        AudioContext: undefined,
        MediaStream: class {},
        audioWorklet: false,
      }).supported,
    ).toBe(false);
  });
});
