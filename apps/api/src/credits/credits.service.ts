import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { calculateMeterCharge } from "./credit-math";

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async wallet(userId: string) {
    await this.refreshIncludedBalance(userId);
    const [wallet, subscription] = await Promise.all([
      this.prisma.creditWallet.findUnique({ where: { userId } }),
      this.prisma.subscription.findFirst({
        where: { userId, status: { in: ["TRIALING", "ACTIVE"] } },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!wallet) {
      throw new NotFoundException("Credit wallet not found");
    }
    return {
      ...wallet,
      exhausted: wallet.availableMilliCredits <= 0,
      activePaidSubscription:
        subscription?.status === "ACTIVE" &&
        subscription.plan.priceMonthlyMinor > 0,
      topUpAllowed:
        subscription?.status === "ACTIVE" &&
        subscription.plan.priceMonthlyMinor > 0 &&
        subscription.plan.creditTopupsAllowed,
      plan: subscription?.plan ?? null,
      nextResetAt: wallet.includedResetAt,
    };
  }

  async transactions(userId: string, take = 50) {
    const wallet = await this.wallet(userId);
    return this.prisma.creditTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 100),
    });
  }

  async reserve(input: {
    userId: string;
    roomId: string;
    amountMilli: number;
    idempotencyKey: string;
  }) {
    if (!Number.isInteger(input.amountMilli) || input.amountMilli <= 0) {
      throw new HttpException("Reservation amount is invalid", 400);
    }
    await this.refreshIncludedBalance(input.userId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.creditTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return existing;
      }

      const wallet = await tx.creditWallet.findUnique({
        where: { userId: input.userId },
      });
      if (!wallet) {
        throw new NotFoundException("Credit wallet not found");
      }
      if (wallet.availableMilliCredits < input.amountMilli) {
        throw new HttpException("Insufficient credits", 402);
      }
      const fromIncluded = Math.min(
        wallet.includedMilliCredits,
        input.amountMilli,
      );
      const fromPurchased = input.amountMilli - fromIncluded;

      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          availableMilliCredits: { decrement: input.amountMilli },
          reservedMilliCredits: { increment: input.amountMilli },
          includedMilliCredits: { decrement: fromIncluded },
          purchasedMilliCredits: { decrement: fromPurchased },
          reservedIncludedMilli: { increment: fromIncluded },
          reservedPurchasedMilli: { increment: fromPurchased },
          version: { increment: 1 },
        },
      });

      return tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          roomId: input.roomId,
          type: "RESERVATION",
          amountMilli: -input.amountMilli,
          balanceAfterMilli: updated.availableMilliCredits,
          source: "call-meter",
          idempotencyKey: input.idempotencyKey,
        },
      });
    });
  }

  async settle(input: {
    userId: string;
    roomId: string;
    participantId?: string;
    meteringWindow: string;
    billableMilliseconds: number;
    milliCreditsPerMinute: number;
    mode: "BASE_CALL" | "AI_FACE" | "VOICE_EFFECT" | "CLOUD_GPU";
    quality: "LOW" | "STANDARD" | "HD";
  }) {
    await this.refreshIncludedBalance(input.userId);
    const entitlement = await this.currentEntitlement(input.userId);
    if (!entitlement) {
      throw new ForbiddenException("An active subscription is required");
    }
    if (!entitlement.plan.allowedQualities.includes(input.quality)) {
      throw new ForbiddenException(
        `${input.quality} quality is not available on this plan`,
      );
    }
    const used = await this.prisma.usageMinute.aggregate({
      where: { roomId: input.roomId, wallet: { userId: input.userId } },
      _sum: { billableMilliseconds: true },
    });
    if (
      (used._sum.billableMilliseconds ?? 0) + input.billableMilliseconds >
      entitlement.plan.maxCallMinutes * 60_000
    ) {
      throw new ForbiddenException("Plan call-duration limit reached");
    }
    const milliCreditsPerMinute = await this.meterRate({
      roomId: input.roomId,
      mode: input.mode,
      quality: input.quality,
    });
    const charge = calculateMeterCharge({
      billableMilliseconds: input.billableMilliseconds,
      milliCreditsPerMinute,
    });
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.usageMinute.findUnique({
        where: { meteringWindow: input.meteringWindow },
      });
      if (existing) {
        return existing;
      }

      const wallet = await tx.creditWallet.findUnique({
        where: { userId: input.userId },
      });
      if (!wallet) {
        throw new NotFoundException("Credit wallet not found");
      }
      if (wallet.reservedMilliCredits + wallet.availableMilliCredits < charge) {
        throw new HttpException("Insufficient credits", 402);
      }

      const fromReservedIncluded = Math.min(
        wallet.reservedIncludedMilli,
        charge,
      );
      const afterReservedIncluded = charge - fromReservedIncluded;
      const fromReservedPurchased = Math.min(
        wallet.reservedPurchasedMilli,
        afterReservedIncluded,
      );
      const fromReserved = fromReservedIncluded + fromReservedPurchased;
      const fromAvailable = charge - fromReserved;
      const fromIncluded = Math.min(wallet.includedMilliCredits, fromAvailable);
      const fromPurchased = fromAvailable - fromIncluded;
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          reservedMilliCredits: { decrement: fromReserved },
          availableMilliCredits: { decrement: fromAvailable },
          reservedIncludedMilli: { decrement: fromReservedIncluded },
          reservedPurchasedMilli: { decrement: fromReservedPurchased },
          includedMilliCredits: { decrement: fromIncluded },
          purchasedMilliCredits: { decrement: fromPurchased },
          lifetimeConsumedMilli: { increment: charge },
          version: { increment: 1 },
        },
      });

      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          roomId: input.roomId,
          type: "USAGE",
          amountMilli: -charge,
          balanceAfterMilli: updated.availableMilliCredits,
          source: input.mode.toLowerCase(),
          idempotencyKey: `usage:${input.meteringWindow}`,
        },
      });

      return tx.usageMinute.create({
        data: {
          walletId: wallet.id,
          roomId: input.roomId,
          ...(input.participantId
            ? { participantId: input.participantId }
            : {}),
          mode: input.mode,
          quality: input.quality,
          billableMilliseconds: input.billableMilliseconds,
          milliCreditsPerMinute,
          milliCreditsCharged: charge,
          meteringWindow: input.meteringWindow,
          startedAt: new Date(Date.now() - input.billableMilliseconds),
          endedAt: new Date(),
        },
      });
    });
  }

  async release(input: {
    userId: string;
    roomId: string;
    amountMilli: number;
    idempotencyKey: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.creditTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return existing;
      }
      const wallet = await tx.creditWallet.findUnique({
        where: { userId: input.userId },
      });
      if (!wallet) {
        throw new NotFoundException("Credit wallet not found");
      }
      const release = Math.min(input.amountMilli, wallet.reservedMilliCredits);
      const includedRelease = Math.min(release, wallet.reservedIncludedMilli);
      const purchasedRelease = release - includedRelease;
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          reservedMilliCredits: { decrement: release },
          availableMilliCredits: { increment: release },
          reservedIncludedMilli: { decrement: includedRelease },
          reservedPurchasedMilli: { decrement: purchasedRelease },
          includedMilliCredits: { increment: includedRelease },
          purchasedMilliCredits: { increment: purchasedRelease },
          version: { increment: 1 },
        },
      });
      return tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          roomId: input.roomId,
          type: "RESERVATION_RELEASE",
          amountMilli: release,
          balanceAfterMilli: updated.availableMilliCredits,
          source: "call-meter",
          idempotencyKey: input.idempotencyKey,
        },
      });
    });
  }

  async quote(
    userId: string,
    input: {
      roomId: string;
      mode: "BASE_CALL" | "AI_FACE" | "VOICE_EFFECT" | "CLOUD_GPU";
      quality: "LOW" | "STANDARD" | "HD";
    },
  ) {
    const entitlement = await this.currentEntitlement(userId);
    if (!entitlement) {
      throw new ForbiddenException("An active subscription is required");
    }
    if (!entitlement.plan.allowedQualities.includes(input.quality)) {
      throw new ForbiddenException("Quality is not available on this plan");
    }
    const milliCreditsPerMinute = await this.meterRate(input);
    return {
      milliCreditsPerMinute,
      creditsPerMinute: milliCreditsPerMinute / 1000,
      fiveMinuteReservationMilli: milliCreditsPerMinute * 5,
    };
  }

  private currentEntitlement(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { userId, status: { in: ["TRIALING", "ACTIVE"] } },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async refreshIncludedBalance(userId: string) {
    const [wallet, entitlement] = await Promise.all([
      this.prisma.creditWallet.findUnique({ where: { userId } }),
      this.currentEntitlement(userId),
    ]);
    if (!wallet || !entitlement) return;
    const now = new Date();
    if (wallet.includedResetAt && wallet.includedResetAt > now) return;
    if (wallet.reservedMilliCredits > 0) return;
    const resetAt =
      entitlement.currentPeriodEnd && entitlement.currentPeriodEnd > now
        ? entitlement.currentPeriodEnd
        : new Date(
            now.getTime() +
              entitlement.plan.creditResetDays * 24 * 60 * 60 * 1000,
          );
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.creditWallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: {
          includedMilliCredits: entitlement.plan.monthlyCredits,
          availableMilliCredits:
            entitlement.plan.monthlyCredits + wallet.purchasedMilliCredits,
          includedResetAt: resetAt,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) return;
      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          type: "SUBSCRIPTION_GRANT",
          amountMilli: entitlement.plan.monthlyCredits,
          balanceAfterMilli:
            entitlement.plan.monthlyCredits + wallet.purchasedMilliCredits,
          source: "subscription-reset",
          reason: `${entitlement.plan.name} included-credit reset`,
          idempotencyKey: `reset:${wallet.id}:${resetAt.toISOString()}`,
          expiresAt: resetAt,
        },
      });
    });
  }

  private async meterRate(input: {
    roomId: string;
    mode: "BASE_CALL" | "AI_FACE" | "VOICE_EFFECT" | "CLOUD_GPU";
    quality: "LOW" | "STANDARD" | "HD";
  }) {
    const [setting, participants] = await Promise.all([
      this.prisma.appSetting.findUnique({
        where: {
          namespace_key: { namespace: "billing", key: "usage-rates" },
        },
      }),
      this.prisma.callParticipant.count({
        where: {
          roomId: input.roomId,
          state: { in: ["APPROVED", "JOINED"] },
        },
      }),
    ]);
    const rates =
      setting?.publicValue && typeof setting.publicValue === "object"
        ? (setting.publicValue as Record<string, unknown>)
        : {};
    const base =
      input.mode === "AI_FACE"
        ? Number(rates.aiFaceMilliPerMinute ?? 1_000)
        : Number(rates.baseCallMilliPerMinute ?? 250);
    const qualityMultiplier =
      input.quality === "HD"
        ? Number(rates.hdMultiplier ?? 1.5)
        : input.quality === "STANDARD"
          ? Number(rates.standardMultiplier ?? 1)
          : Number(rates.lowMultiplier ?? 0.75);
    const participantMultiplier =
      1 +
      Math.max(0, participants - 1) *
        Number(rates.additionalParticipantMultiplier ?? 0.25);
    const featureMultiplier =
      input.mode === "CLOUD_GPU"
        ? Number(rates.cloudGpuMultiplier ?? 2.5)
        : input.mode === "VOICE_EFFECT"
          ? Number(rates.voiceEffectMultiplier ?? 1.25)
          : 1;
    return Math.max(
      1,
      Math.ceil(
        base * qualityMultiplier * participantMultiplier * featureMultiplier,
      ),
    );
  }
}
