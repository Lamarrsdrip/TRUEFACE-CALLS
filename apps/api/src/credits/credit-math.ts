export function calculateMeterCharge(input: {
  billableMilliseconds: number;
  milliCreditsPerMinute: number;
}): number {
  if (
    !Number.isFinite(input.billableMilliseconds) ||
    input.billableMilliseconds < 0 ||
    !Number.isInteger(input.milliCreditsPerMinute) ||
    input.milliCreditsPerMinute < 0
  ) {
    throw new Error("Meter input must be non-negative");
  }

  return Math.ceil(
    (input.billableMilliseconds * input.milliCreditsPerMinute) / 60_000,
  );
}

export function reserveForMinutes(input: {
  minutes: number;
  milliCreditsPerMinute: number;
}): number {
  if (
    !Number.isFinite(input.minutes) ||
    input.minutes <= 0 ||
    !Number.isInteger(input.milliCreditsPerMinute) ||
    input.milliCreditsPerMinute < 0
  ) {
    throw new Error("Reservation input is invalid");
  }
  return Math.ceil(input.minutes * input.milliCreditsPerMinute);
}
