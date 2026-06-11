import { describe, expect, it } from "vitest";
import { assertFaceProfileCanActivate } from "./face-policy";

describe("face activation policy", () => {
  it("requires approved moderation and active consent", () => {
    expect(() =>
      assertFaceProfileCanActivate({
        moderationStatus: "APPROVED",
        deletedAt: null,
        consentRevokedAt: null,
        consent: {
          ownsOrHasPermission: true,
          consentsToFaceUse: true,
          acceptsFaceTerms: true,
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertFaceProfileCanActivate({
        moderationStatus: "PENDING",
        deletedAt: null,
        consentRevokedAt: null,
        consent: {
          ownsOrHasPermission: true,
          consentsToFaceUse: true,
          acceptsFaceTerms: true,
        },
      }),
    ).toThrow("approved");
  });
});
