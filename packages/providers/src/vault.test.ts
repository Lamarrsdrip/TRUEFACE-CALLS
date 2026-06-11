import { describe, expect, it } from "vitest";
import {
  decryptSetting,
  encryptSetting,
  fingerprintSecret,
  resolveProviderValue,
} from "./index.js";

const masterKey = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);

describe("settings vault", () => {
  it("round trips provider credentials without storing plaintext", () => {
    const encrypted = encryptSetting("livekit-secret", masterKey);

    expect(encrypted).not.toContain("livekit-secret");
    expect(decryptSetting(encrypted, masterKey)).toBe("livekit-secret");
    expect(fingerprintSecret("livekit-secret")).toMatch(/^\.\.\.[A-F0-9]{4}$/);
  });

  it("rejects tampered encrypted settings", () => {
    const encrypted = encryptSetting("stripe-secret", masterKey);
    const tampered = `${encrypted.slice(0, -2)}AA`;

    expect(() => decryptSetting(tampered, masterKey)).toThrow();
  });
});

describe("provider setting precedence", () => {
  it("prefers an admin setting over an environment fallback", () => {
    expect(
      resolveProviderValue({
        encryptedAdminValue: encryptSetting("admin-value", masterKey),
        environmentValue: "environment-value",
        masterKey,
      }),
    ).toEqual({ value: "admin-value", source: "admin" });
  });

  it("returns an explicit unconfigured state", () => {
    expect(
      resolveProviderValue({
        encryptedAdminValue: null,
        environmentValue: undefined,
        masterKey,
      }),
    ).toEqual({ value: null, source: "unconfigured" });
  });
});
