export function creditsFromMilli(value: number): string {
  const credits = value / 1000;
  return Number.isInteger(credits)
    ? String(credits)
    : credits.toFixed(1).replace(/\.0$/, "");
}

export function estimatedMinutes(
  milliCredits: number,
  milliCreditsPerMinute: number,
): number {
  if (milliCreditsPerMinute <= 0) return 0;
  return Math.floor(milliCredits / milliCreditsPerMinute);
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function moneyFromMinor(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(value / 100);
}
