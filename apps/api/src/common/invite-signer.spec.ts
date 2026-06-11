import { describe, expect, it } from "vitest";
import { InviteSigner } from "./invite-signer";

describe("InviteSigner", () => {
  const signer = new InviteSigner(
    "a-secret-that-is-long-enough-for-signed-invites",
  );

  it("verifies an unmodified, unexpired room invite", () => {
    const token = signer.sign({
      roomId: "c9cb1790-a28a-45ab-8f89-30a02bf74e31",
      inviteVersion: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(signer.verify(token)).toMatchObject({
      roomId: "c9cb1790-a28a-45ab-8f89-30a02bf74e31",
      inviteVersion: 3,
    });
  });

  it("rejects tampered and expired invites", () => {
    const expired = signer.sign({
      roomId: "c9cb1790-a28a-45ab-8f89-30a02bf74e31",
      inviteVersion: 1,
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(() => signer.verify(expired)).toThrow("expired");
    expect(() => signer.verify(`${expired.slice(0, -1)}x`)).toThrow();
  });
});
