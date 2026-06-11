import { describe, expect, it } from "vitest";
import { creditsFromMilli, estimatedMinutes, formatDuration } from "./format";

describe("billing display helpers", () => {
  it("formats milli-credits without hiding fractional balance", () => {
    expect(creditsFromMilli(12_500)).toBe("12.5");
  });

  it("estimates whole minutes conservatively", () => {
    expect(estimatedMinutes(12_500, 2_500)).toBe(5);
  });

  it("formats a call duration", () => {
    expect(formatDuration(3_725_000)).toBe("1h 2m");
  });
});
