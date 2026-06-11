import { describe, expect, it } from "vitest";
import { calculateMeterCharge, reserveForMinutes } from "./credit-math";

describe("credit metering math", () => {
  it("rounds usage up to a whole milli-credit", () => {
    expect(
      calculateMeterCharge({
        billableMilliseconds: 30_000,
        milliCreditsPerMinute: 2_501,
      }),
    ).toBe(1_251);
  });

  it("reserves an exact upper bound for the requested minutes", () => {
    expect(
      reserveForMinutes({ minutes: 5, milliCreditsPerMinute: 4_500 }),
    ).toBe(22_500);
  });
});
