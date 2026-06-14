import { z } from "zod";

export const qualityKeySchema = z.enum(["low", "standard", "hd"]);
export type QualityKey = z.infer<typeof qualityKeySchema>;

export const consentAttestationSchema = z
  .object({
    ownsOrHasPermission: z.literal(true),
    consentsToFaceUse: z.literal(true),
    acceptsFaceTerms: z.literal(true),
    termsVersion: z.string().min(1).max(64),
  })
  .strict();

export type ConsentAttestation = z.infer<typeof consentAttestationSchema>;

export interface PlanEntitlements {
  planKey: "trial" | "basic" | "pro" | "business";
  monthlyCredits: number;
  maxFaceProfiles: number;
  maxParticipants: number;
  allowedQualities: QualityKey[];
  groupCalls: boolean;
  voiceEffects: boolean;
  cloudGpu: boolean;
}

export type FeatureRequest =
  | { feature: "quality"; quality: QualityKey }
  | { feature: "groupCalls" }
  | { feature: "voiceEffects" }
  | { feature: "cloudGpu" };

export function canUseFeature(
  plan: PlanEntitlements,
  request: FeatureRequest,
): boolean {
  switch (request.feature) {
    case "quality":
      return plan.allowedQualities.includes(request.quality);
    case "groupCalls":
      return plan.groupCalls;
    case "voiceEffects":
      return plan.voiceEffects;
    case "cloudGpu":
      return plan.cloudGpu;
  }
}

export interface CreditRateInput {
  aiFace: boolean;
  voiceEffect: boolean;
  quality: QualityKey;
  cloudGpu: boolean;
}

export interface CreditRate {
  milliCreditsPerMinute: number;
  components: {
    baseCall: number;
    aiFace: number;
    voiceEffect: number;
    quality: number;
    cloudGpu: number;
  };
}

const QUALITY_SURCHARGE: Record<QualityKey, number> = {
  low: 0,
  standard: 500,
  hd: 2000,
};

export function calculateCreditRate(input: CreditRateInput): CreditRate {
  const components = {
    baseCall: 500,
    aiFace: input.aiFace ? 1500 : 0,
    voiceEffect: input.voiceEffect ? 500 : 0,
    quality: QUALITY_SURCHARGE[input.quality],
    cloudGpu: input.cloudGpu ? 3000 : 0,
  };

  return {
    milliCreditsPerMinute: Object.values(components).reduce(
      (total, value) => total + value,
      0,
    ),
    components,
  };
}

export interface DeviceCapability {
  logicalCores: number;
  memoryGb?: number;
  benchmarkFps: number;
  webgl2: boolean;
  thermalPressure: boolean;
}

export interface QualityProfile {
  key: QualityKey;
  width: number;
  height: number;
  targetFps: number;
  maxTrackingFaces: number;
}

export const QUALITY_PROFILES: Record<QualityKey, QualityProfile> = {
  low: {
    key: "low",
    width: 640,
    height: 360,
    targetFps: 15,
    maxTrackingFaces: 1,
  },
  standard: {
    key: "standard",
    width: 854,
    height: 480,
    targetFps: 24,
    maxTrackingFaces: 1,
  },
  hd: {
    key: "hd",
    width: 1280,
    height: 720,
    targetFps: 30,
    maxTrackingFaces: 1,
  },
};

export function selectQualityProfile(
  capability: DeviceCapability,
): QualityProfile {
  const memory = capability.memoryGb ?? 4;

  if (
    capability.thermalPressure ||
    capability.logicalCores <= 2 ||
    memory <= 2 ||
    capability.benchmarkFps < 18
  ) {
    return QUALITY_PROFILES.low;
  }

  if (
    capability.webgl2 &&
    capability.logicalCores >= 6 &&
    memory >= 6 &&
    capability.benchmarkFps >= 28
  ) {
    return QUALITY_PROFILES.hd;
  }

  return QUALITY_PROFILES.standard;
}

export const roomRoleSchema = z.enum(["host", "moderator", "participant"]);
export type RoomRole = z.infer<typeof roomRoleSchema>;

export const providerKeySchema = z.enum([
  "livekit",
  "storage",
  "email",
  "paystack",
  "flutterwave",
  "ai",
  "gpu",
  "manual-bank",
  "monitoring",
  "whatsapp",
]);
export type ProviderKey = z.infer<typeof providerKeySchema>;

export const createRoomSchema = z.object({
  title: z.string().trim().min(1).max(120),
  waitingRoom: z.boolean().default(true),
  allowGuests: z.boolean().default(true),
  expiresInMinutes: z.number().int().min(5).max(43_200).default(1_440),
  password: z.string().min(8).max(128).optional(),
  maxParticipants: z.number().int().min(2).max(100).default(2),
});

export const signupSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number"),
  displayName: z.string().trim().min(2).max(80),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
