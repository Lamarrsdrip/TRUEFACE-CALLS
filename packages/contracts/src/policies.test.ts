import { describe, expect, it } from "vitest";
import {
  calculateCreditRate,
  canUseFeature,
  consentAttestationSchema,
  selectQualityProfile,
  type PlanEntitlements,
} from "./index.js";

const pro: PlanEntitlements = {
  planKey: "pro",
  monthlyCredits: 600,
  maxFaceProfiles: 10,
  maxParticipants: 12,
  allowedQualities: ["low", "standard", "hd"],
  groupCalls: true,
  voiceEffects: true,
  cloudGpu: false,
};

describe("consent policy", () => {
  it("rejects a face profile when any required attestation is missing", () => {
    const result = consentAttestationSchema.safeParse({
      ownsOrHasPermission: true,
      consentsToFaceUse: true,
      acceptsFaceTerms: false,
      termsVersion: "2026-06-11",
    });

    expect(result.success).toBe(false);
  });
});

describe("plan entitlements", () => {
  it("allows HD for pro and rejects unsupported cloud GPU", () => {
    expect(canUseFeature(pro, { feature: "quality", quality: "hd" })).toBe(
      true,
    );
    expect(canUseFeature(pro, { feature: "cloudGpu" })).toBe(false);
  });
});

describe("credit rates", () => {
  it("combines enabled usage components as milli-credits per minute", () => {
    expect(
      calculateCreditRate({
        aiFace: true,
        voiceEffect: true,
        quality: "hd",
        cloudGpu: false,
      }),
    ).toEqual({
      milliCreditsPerMinute: 4500,
      components: {
        baseCall: 500,
        aiFace: 1500,
        voiceEffect: 500,
        quality: 2000,
        cloudGpu: 0,
      },
    });
  });
});

describe("adaptive quality", () => {
  it("selects low mode for weak or thermally constrained devices", () => {
    expect(
      selectQualityProfile({
        logicalCores: 2,
        memoryGb: 2,
        benchmarkFps: 13,
        webgl2: false,
        thermalPressure: true,
      }).key,
    ).toBe("low");
  });

  it("selects HD only for capable devices", () => {
    expect(
      selectQualityProfile({
        logicalCores: 8,
        memoryGb: 8,
        benchmarkFps: 32,
        webgl2: true,
        thermalPressure: false,
      }).key,
    ).toBe("hd");
  });
});
