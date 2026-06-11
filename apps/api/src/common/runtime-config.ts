export function authSecret(): string {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return "development-auth-secret-that-is-at-least-32-characters";
}
