import {
  AdminRole,
  PaymentProvider,
  PrismaClient,
  QualityMode,
  SubscriptionStatus,
} from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const plans = [
  {
    key: "trial",
    name: "Free Trial",
    description: "A consent-first 30 second AI face call trial.",
    monthlyCredits: 1_500,
    maxFaceProfiles: 1,
    maxImagesPerProfile: 1,
    maxParticipants: 2,
    maxCallMinutes: 1,
    maxGroupCalls: 0,
    watermarkRequired: true,
    creditTopupsAllowed: false,
    creditResetDays: 7,
    allowedQualities: [QualityMode.LOW, QualityMode.STANDARD],
    groupCalls: false,
    voiceEffects: false,
    cloudGpu: false,
    priceMonthlyMinor: 0,
    sortOrder: 0,
  },
  {
    key: "basic",
    name: "Basic",
    description: "Standard quality for regular one-to-one calls.",
    monthlyCredits: 30_000,
    maxFaceProfiles: 3,
    maxImagesPerProfile: 2,
    maxParticipants: 2,
    maxCallMinutes: 60,
    maxGroupCalls: 0,
    watermarkRequired: true,
    creditTopupsAllowed: true,
    creditResetDays: 30,
    allowedQualities: [QualityMode.LOW, QualityMode.STANDARD],
    groupCalls: false,
    voiceEffects: true,
    cloudGpu: false,
    priceMonthlyMinor: 1_900,
    sortOrder: 1,
  },
  {
    key: "pro",
    name: "Pro",
    description: "HD, group calls, and priority browser processing.",
    monthlyCredits: 120_000,
    maxFaceProfiles: 10,
    maxImagesPerProfile: 5,
    maxParticipants: 12,
    maxCallMinutes: 240,
    maxGroupCalls: 100,
    watermarkRequired: true,
    creditTopupsAllowed: true,
    creditResetDays: 30,
    allowedQualities: [QualityMode.LOW, QualityMode.STANDARD, QualityMode.HD],
    groupCalls: true,
    voiceEffects: true,
    cloudGpu: false,
    priceMonthlyMinor: 4_900,
    sortOrder: 2,
  },
  {
    key: "business",
    name: "Business",
    description: "Teams, branding, analytics, and configurable limits.",
    monthlyCredits: 500_000,
    maxFaceProfiles: 50,
    maxImagesPerProfile: 10,
    maxParticipants: 50,
    maxCallMinutes: 720,
    maxGroupCalls: 1000,
    watermarkRequired: false,
    creditTopupsAllowed: true,
    creditResetDays: 30,
    allowedQualities: [QualityMode.LOW, QualityMode.STANDARD, QualityMode.HD],
    groupCalls: true,
    voiceEffects: true,
    cloudGpu: true,
    priceMonthlyMinor: 14_900,
    sortOrder: 3,
  },
] as const;

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: plan,
      create: plan,
    });
  }

  await prisma.appSetting.upsert({
    where: {
      namespace_key: { namespace: "branding", key: "public" },
    },
    update: {},
    create: {
      namespace: "branding",
      key: "public",
      publicValue: {
        appName: "TrueFace Calls",
        supportEmail: "support@example.com",
        primaryColor: "#4f46e5",
      },
    },
  });

  const defaultSettings = [
    {
      namespace: "billing",
      key: "credit-packs",
      publicValue: {
        packs: [
          {
            key: "starter",
            name: "Starter credits",
            creditsMilli: 25_000,
            amountMinor: 500,
            currency: "USD",
          },
          {
            key: "creator",
            name: "Creator credits",
            creditsMilli: 120_000,
            amountMinor: 2_000,
            currency: "USD",
          },
        ],
      },
    },
    {
      namespace: "billing",
      key: "usage-rates",
      publicValue: {
        baseCallMilliPerMinute: 250,
        aiFaceMilliPerMinute: 1_000,
        voiceEffectMultiplier: 1.25,
        hdMultiplier: 1.5,
        cloudGpuMultiplier: 2.5,
      },
    },
    {
      namespace: "features",
      key: "flags",
      publicValue: {
        guestJoin: true,
        screenShare: true,
        voiceEffects: false,
        cloudGpu: false,
        manualBankTransfer: false,
      },
    },
    {
      namespace: "safety",
      key: "policy",
      publicValue: {
        abuseReportingEnabled: true,
        faceModerationRequired: true,
        consentTermsVersion: "2026-06",
        deleteRejectedFaceMedia: true,
      },
    },
  ];

  for (const setting of defaultSettings) {
    await prisma.appSetting.upsert({
      where: {
        namespace_key: {
          namespace: setting.namespace,
          key: setting.key,
        },
      },
      update: {},
      create: setting,
    });
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const previewEmail = process.env.BOOTSTRAP_PREVIEW_EMAIL;
  const previewPassword = process.env.BOOTSTRAP_PREVIEW_PASSWORD;
  const trial = await prisma.plan.findUniqueOrThrow({
    where: { key: "trial" },
  });

  if (adminEmail && adminPassword) {
    const user = await ensureBootstrapUser(
      adminEmail,
      adminPassword,
      "Platform Admin",
      trial.id,
      trial.monthlyCredits,
    );

    await prisma.adminUser.upsert({
      where: { userId: user.id },
      update: { active: true },
      create: {
        userId: user.id,
        role: AdminRole.SUPER_ADMIN,
        permissions: ["*"],
      },
    });
  }

  if (previewEmail && previewPassword) {
    await ensureBootstrapUser(
      previewEmail,
      previewPassword,
      "Preview Viewer",
      trial.id,
      trial.monthlyCredits,
    );
  }
}

async function ensureBootstrapUser(
  email: string,
  password: string,
  displayName: string,
  planId: string,
  trialCredits: number,
) {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      displayName,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: normalizedEmail,
      displayName,
      passwordHash: await argon2.hash(password, {
        type: argon2.argon2id,
      }),
      emailVerifiedAt: new Date(),
    },
  });

  const wallet = await prisma.creditWallet.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      availableMilliCredits: trialCredits,
      includedMilliCredits: trialCredits,
      includedResetAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const existingSubscription = await prisma.subscription.findFirst({
    where: { userId: user.id },
  });
  if (!existingSubscription) {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId,
        provider: PaymentProvider.MANUAL,
        status: SubscriptionStatus.TRIALING,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  await prisma.creditTransaction.upsert({
    where: { idempotencyKey: `bootstrap:${user.id}` },
    update: {},
    create: {
      walletId: wallet.id,
      type: "TRIAL_GRANT",
      amountMilli: trialCredits,
      balanceAfterMilli: wallet.availableMilliCredits,
      source: "bootstrap",
      idempotencyKey: `bootstrap:${user.id}`,
    },
  });

  return user;
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
