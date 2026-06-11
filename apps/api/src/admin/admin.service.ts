import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [
      users,
      activeSubscriptions,
      calls,
      pendingFaces,
      openReports,
      revenue,
      usage,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.subscription.count({ where: { status: "ACTIVE" } }),
      this.prisma.callRoom.count(),
      this.prisma.faceProfile.count({
        where: { moderationStatus: "PENDING", deletedAt: null },
      }),
      this.prisma.abuseReport.count({
        where: { status: { in: ["OPEN", "INVESTIGATING"] } },
      }),
      this.prisma.payment.aggregate({
        where: { status: "SUCCEEDED" },
        _sum: { amountMinor: true },
      }),
      this.prisma.usageMinute.aggregate({
        _sum: {
          billableMilliseconds: true,
          milliCreditsCharged: true,
        },
      }),
    ]);
    return {
      users,
      activeSubscriptions,
      calls,
      pendingFaces,
      openReports,
      revenueMinor: revenue._sum.amountMinor ?? 0,
      aiMinutes: Math.round((usage._sum.billableMilliseconds ?? 0) / 60_000),
      creditsConsumedMilli: usage._sum.milliCreditsCharged ?? 0,
    };
  }

  users() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        creditWallet: true,
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async updateUserStatus(
    id: string,
    adminId: string,
    status: "ACTIVE" | "SUSPENDED" | "DELETION_PENDING",
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });
      const updated = await tx.user.update({
        where: { id },
        data: { status },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "user.status.update",
          targetType: "user",
          targetId: id,
          beforeRedacted: before,
          afterRedacted: { status },
          requestId: randomUUID(),
        },
      });
      return updated;
    });
  }

  subscriptions() {
    return this.prisma.subscription.findMany({
      include: {
        user: { select: { email: true, displayName: true } },
        team: { select: { name: true } },
        plan: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  payments() {
    return this.prisma.payment.findMany({
      include: {
        user: { select: { email: true, displayName: true } },
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  calls() {
    return this.prisma.callRoom.findMany({
      include: {
        host: { select: { email: true, displayName: true } },
        history: true,
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  usage() {
    return this.prisma.usageMinute.findMany({
      include: {
        room: { select: { title: true } },
        wallet: { select: { userId: true, teamId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  faceQueue() {
    return this.prisma.faceProfile.findMany({
      where: { moderationStatus: { in: ["PENDING", "QUARANTINED"] } },
      include: {
        user: { select: { email: true, displayName: true } },
        consentLogs: { orderBy: { acceptedAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  }

  async decideFace(
    faceId: string,
    adminId: string,
    input: {
      status: "APPROVED" | "REJECTED" | "QUARANTINED";
      reasonCodes: string[];
      note?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.faceProfile.update({
        where: { id: faceId },
        data: { moderationStatus: input.status },
      });
      await tx.faceModerationEvent.create({
        data: {
          faceProfileId: faceId,
          moderatorId: adminId,
          status: input.status,
          reasonCodes: input.reasonCodes,
          ...(input.note ? { note: input.note.slice(0, 2_000) } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "face.moderation.decide",
          targetType: "face_profile",
          targetId: faceId,
          afterRedacted: {
            status: input.status,
            reasonCodes: input.reasonCodes,
          },
          requestId: randomUUID(),
        },
      });
      return profile;
    });
  }

  reports() {
    return this.prisma.abuseReport.findMany({
      include: {
        reporter: { select: { email: true, displayName: true } },
        reportedUser: { select: { email: true, displayName: true } },
        room: { select: { title: true } },
        faceProfile: { select: { name: true, moderationStatus: true } },
        assignedAdmin: {
          include: { user: { select: { displayName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async updateReport(
    id: string,
    adminId: string,
    input: {
      status: "OPEN" | "INVESTIGATING" | "ACTIONED" | "DISMISSED";
      resolution?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.abuseReport.update({
        where: { id },
        data: {
          status: input.status,
          assignedAdminId: adminId,
          ...(input.resolution
            ? { resolution: input.resolution.slice(0, 5_000) }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "abuse_report.update",
          targetType: "abuse_report",
          targetId: id,
          afterRedacted: { status: input.status },
          requestId: randomUUID(),
        },
      });
      return report;
    });
  }

  async adjustCredits(
    adminId: string,
    input: { userId: string; amountMilli: number; reason: string },
  ) {
    if (
      !Number.isInteger(input.amountMilli) ||
      input.amountMilli === 0 ||
      input.reason.trim().length < 5
    ) {
      throw new BadRequestException("Adjustment and reason are required");
    }
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.findUnique({
        where: { userId: input.userId },
      });
      if (!wallet) {
        throw new NotFoundException("Credit wallet not found");
      }
      if (wallet.availableMilliCredits + input.amountMilli < 0) {
        throw new BadRequestException("Adjustment would make balance negative");
      }
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          availableMilliCredits: { increment: input.amountMilli },
          version: { increment: 1 },
        },
      });
      const transaction = await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          actorAdminId: adminId,
          type: "ADMIN_ADJUSTMENT",
          amountMilli: input.amountMilli,
          balanceAfterMilli: updated.availableMilliCredits,
          source: "admin",
          reason: input.reason.trim(),
          idempotencyKey: `admin:${adminId}:${randomUUID()}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "credits.adjust",
          targetType: "credit_wallet",
          targetId: wallet.id,
          afterRedacted: {
            amountMilli: input.amountMilli,
            reason: input.reason.trim(),
          },
          requestId: randomUUID(),
        },
      });
      return transaction;
    });
  }

  plans() {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
  }

  async updatePlan(
    id: string,
    adminId: string,
    input: Partial<{
      name: string;
      description: string;
      monthlyCredits: number;
      maxFaceProfiles: number;
      maxParticipants: number;
      groupCalls: boolean;
      voiceEffects: boolean;
      cloudGpu: boolean;
      priceMonthlyMinor: number;
      enabled: boolean;
      providerPriceRefs: object;
    }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.plan.update({ where: { id }, data: input });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "plan.update",
          targetType: "plan",
          targetId: id,
          afterRedacted: input,
          requestId: randomUUID(),
        },
      });
      return updated;
    });
  }

  settings(namespace?: string) {
    return this.prisma.appSetting.findMany({
      where: namespace ? { namespace } : { encryptedValue: null },
      select: {
        id: true,
        namespace: true,
        key: true,
        publicValue: true,
        secretFingerprint: true,
        version: true,
        updatedAt: true,
      },
      orderBy: [{ namespace: "asc" }, { key: "asc" }],
    });
  }

  async setPublicSetting(
    namespace: string,
    key: string,
    value: object,
    userId: string,
    adminId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const setting = await tx.appSetting.upsert({
        where: { namespace_key: { namespace, key } },
        update: {
          publicValue: value,
          encryptedValue: null,
          secretFingerprint: null,
          updatedById: userId,
          version: { increment: 1 },
        },
        create: { namespace, key, publicValue: value, updatedById: userId },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "app_setting.update",
          targetType: "app_setting",
          targetId: setting.id,
          afterRedacted: { namespace, key, value },
          requestId: randomUUID(),
        },
      });
      return setting;
    });
  }

  async broadcast(
    adminId: string,
    input: { title: string; body: string; audience?: string },
  ) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length < 3 || body.length < 5) {
      throw new BadRequestException("A title and message are required");
    }
    return this.prisma.$transaction(async (tx) => {
      const audience = input.audience?.trim() || "ALL";
      const users = await tx.user.findMany({
        where:
          audience === "ACTIVE_SUBSCRIBERS"
            ? {
                subscriptions: {
                  some: { status: { in: ["ACTIVE", "TRIALING"] } },
                },
              }
            : { status: "ACTIVE" },
        select: { id: true },
      });
      const broadcastId = randomUUID();
      await tx.notification.createMany({
        data: users.map((user) => ({
          userId: user.id,
          audience,
          channel: "IN_APP",
          title: title.slice(0, 120),
          body: body.slice(0, 2_000),
          data: { broadcastId },
          deliveredAt: new Date(),
        })),
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "notification.broadcast",
          targetType: "notification",
          targetId: broadcastId,
          afterRedacted: { audience, title, recipients: users.length },
          requestId: randomUUID(),
        },
      });
      return { broadcastId, recipients: users.length };
    });
  }

  auditLogs() {
    return this.prisma.auditLog.findMany({
      include: {
        actorUser: { select: { email: true, displayName: true } },
        actorAdmin: {
          include: { user: { select: { email: true, displayName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
}
