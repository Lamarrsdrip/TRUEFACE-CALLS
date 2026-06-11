import { HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { calculateMeterCharge } from "./credit-math";

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async wallet(userId: string) {
    const wallet = await this.prisma.creditWallet.findUnique({
      where: { userId },
    });
    if (!wallet) {
      throw new NotFoundException("Credit wallet not found");
    }
    return wallet;
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

      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          availableMilliCredits: { decrement: input.amountMilli },
          reservedMilliCredits: { increment: input.amountMilli },
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
    const charge = calculateMeterCharge(input);
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

      const fromReserved = Math.min(wallet.reservedMilliCredits, charge);
      const fromAvailable = charge - fromReserved;
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          reservedMilliCredits: { decrement: fromReserved },
          availableMilliCredits: { decrement: fromAvailable },
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
          milliCreditsPerMinute: input.milliCreditsPerMinute,
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
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          reservedMilliCredits: { decrement: release },
          availableMilliCredits: { increment: release },
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
}
