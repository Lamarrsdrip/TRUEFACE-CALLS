import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { ProvidersService } from "../providers/providers.service";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  async overview() {
    const [
      users,
      activeSubscriptions,
      trialUsers,
      activeRooms,
      pendingFaces,
      faceProfiles,
      openReports,
      pendingManualPayments,
      revenue,
      creditsSold,
      usage,
      providerHealth,
      failedWebhooks,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.subscription.count({ where: { status: "ACTIVE" } }),
      this.prisma.subscription.count({ where: { status: "TRIALING" } }),
      this.prisma.callRoom.count({
        where: { status: { in: ["OPEN", "ACTIVE"] } },
      }),
      this.prisma.faceProfile.count({
        where: { moderationStatus: "PENDING", deletedAt: null },
      }),
      this.prisma.faceProfile.count({ where: { deletedAt: null } }),
      this.prisma.abuseReport.count({
        where: { status: { in: ["OPEN", "INVESTIGATING"] } },
      }),
      this.prisma.payment.count({
        where: { provider: "MANUAL", status: "PENDING" },
      }),
      this.prisma.payment.aggregate({
        where: { status: "SUCCEEDED" },
        _sum: { amountMinor: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: "SUCCEEDED", creditsMilli: { not: null } },
        _sum: { creditsMilli: true },
      }),
      this.prisma.usageMinute.aggregate({
        _sum: {
          billableMilliseconds: true,
          milliCreditsCharged: true,
        },
      }),
      this.prisma.providerHealth.findMany({
        orderBy: { provider: "asc" },
      }),
      this.prisma.webhookEvent.count({ where: { status: "FAILED" } }),
    ]);
    return {
      users,
      activeSubscriptions,
      trialUsers,
      activeRooms,
      pendingFaces,
      faceProfiles,
      openReports,
      pendingManualPayments,
      revenueMinor: revenue._sum.amountMinor ?? 0,
      creditsSoldMilli: creditsSold._sum.creditsMilli ?? 0,
      aiMinutes: Math.round((usage._sum.billableMilliseconds ?? 0) / 60_000),
      creditsConsumedMilli: usage._sum.milliCreditsCharged ?? 0,
      providerHealth,
      failedWebhooks,
      systemAlerts:
        pendingManualPayments +
        openReports +
        failedWebhooks +
        providerHealth.filter((provider) =>
          ["DEGRADED", "DOWN"].includes(provider.status),
        ).length,
    };
  }

  users(search?: string) {
    const query = search?.trim().slice(0, 120);
    return this.prisma.user.findMany({
      ...(query
        ? {
            where: {
              OR: [
                { email: { contains: query, mode: "insensitive" } },
                { displayName: { contains: query, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        roomCreationDisabled: true,
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

  async user(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        creditWallet: {
          include: {
            transactions: { take: 25, orderBy: { createdAt: "desc" } },
          },
        },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: "desc" },
        },
        faceProfiles: { orderBy: { createdAt: "desc" } },
        payments: {
          include: { refunds: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        callParticipants: {
          include: { room: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        reportsAgainst: { orderBy: { createdAt: "desc" }, take: 25 },
        devices: { orderBy: { lastSeenAt: "desc" } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
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

  async updateRoomAccess(id: string, adminId: string, disabled: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { roomCreationDisabled: disabled },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "user.room_access.update",
          targetType: "user",
          targetId: id,
          afterRedacted: { roomCreationDisabled: disabled },
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

  payments(filters: { provider?: string; status?: string } = {}) {
    const providers = ["STRIPE", "PAYSTACK", "FLUTTERWAVE", "MANUAL"];
    const statuses = [
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "CANCELED",
    ];
    return this.prisma.payment.findMany({
      where: {
        ...(filters.provider && providers.includes(filters.provider)
          ? {
              provider: filters.provider as
                | "STRIPE"
                | "PAYSTACK"
                | "FLUTTERWAVE"
                | "MANUAL",
            }
          : {}),
        ...(filters.status && statuses.includes(filters.status)
          ? {
              status: filters.status as
                | "PENDING"
                | "SUCCEEDED"
                | "FAILED"
                | "REFUNDED"
                | "PARTIALLY_REFUNDED"
                | "CANCELED",
            }
          : {}),
      },
      include: {
        user: { select: { email: true, displayName: true } },
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async decideManualPayment(
    id: string,
    adminId: string,
    input: { decision: "APPROVE" | "REJECT"; reason?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (
        !payment ||
        payment.provider !== "MANUAL" ||
        payment.status !== "PENDING"
      ) {
        throw new BadRequestException("Pending manual payment not found");
      }
      const approved = input.decision === "APPROVE";
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: approved ? "SUCCEEDED" : "FAILED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
          ...(input.reason
            ? { adminNotes: input.reason.trim().slice(0, 2_000) }
            : {}),
          ...(!approved
            ? {
                failureCode: "MANUAL_REJECTED",
                failureMessage:
                  input.reason?.trim().slice(0, 500) ||
                  "Rejected by finance administrator",
              }
            : {}),
        },
      });

      if (
        approved &&
        payment.type === "CREDIT_PURCHASE" &&
        payment.creditsMilli
      ) {
        const wallet = await tx.creditWallet.findUniqueOrThrow({
          where: { userId: payment.userId },
        });
        const walletAfter = await tx.creditWallet.update({
          where: { id: wallet.id, version: wallet.version },
          data: {
            availableMilliCredits: { increment: payment.creditsMilli },
            purchasedMilliCredits: { increment: payment.creditsMilli },
            lifetimePurchasedMilli: { increment: payment.creditsMilli },
            version: { increment: 1 },
          },
        });
        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            paymentId: payment.id,
            actorAdminId: adminId,
            type: "PURCHASE",
            amountMilli: payment.creditsMilli,
            balanceAfterMilli: walletAfter.availableMilliCredits,
            source: "manual-transfer",
            idempotencyKey: `manual-payment:${payment.id}`,
          },
        });
      } else if (approved && payment.type === "SUBSCRIPTION") {
        const metadata =
          payment.metadata && typeof payment.metadata === "object"
            ? (payment.metadata as Record<string, string>)
            : {};
        if (!metadata.planId) {
          throw new BadRequestException(
            "Manual subscription payment has no plan",
          );
        }
        await tx.subscription.updateMany({
          where: {
            userId: payment.userId,
            status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
          },
          data: { status: "CANCELED", canceledAt: new Date() },
        });
        const subscription = await tx.subscription.create({
          data: {
            userId: payment.userId,
            planId: metadata.planId,
            provider: "MANUAL",
            status: "ACTIVE",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        const plan = await tx.plan.findUniqueOrThrow({
          where: { id: metadata.planId },
        });
        const wallet = await tx.creditWallet.findUniqueOrThrow({
          where: { userId: payment.userId },
        });
        const resetAt =
          subscription.currentPeriodEnd ??
          new Date(Date.now() + plan.creditResetDays * 24 * 60 * 60 * 1000);
        const walletAfter = await tx.creditWallet.update({
          where: { id: wallet.id, version: wallet.version },
          data: {
            includedMilliCredits: plan.monthlyCredits,
            availableMilliCredits:
              plan.monthlyCredits + wallet.purchasedMilliCredits,
            includedResetAt: resetAt,
            version: { increment: 1 },
          },
        });
        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            paymentId: payment.id,
            actorAdminId: adminId,
            type: "SUBSCRIPTION_GRANT",
            amountMilli: plan.monthlyCredits,
            balanceAfterMilli: walletAfter.availableMilliCredits,
            source: "manual-transfer",
            reason: `${plan.name} included monthly credits`,
            idempotencyKey: `manual-subscription:${payment.id}`,
            expiresAt: resetAt,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: approved ? "payment.manual.approve" : "payment.manual.reject",
          targetType: "payment",
          targetId: id,
          afterRedacted: {
            decision: input.decision,
            reason: input.reason?.slice(0, 500),
          },
          requestId: randomUUID(),
        },
      });
      return updated;
    });
  }

  async manualPaymentProof(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.provider !== "MANUAL") {
      throw new NotFoundException("Manual payment not found");
    }
    const metadata =
      payment.metadata && typeof payment.metadata === "object"
        ? (payment.metadata as Record<string, string>)
        : {};
    if (!metadata.proofObjectKey) {
      throw new NotFoundException("Payment proof was not uploaded");
    }
    return {
      url: await this.providers.createDownloadUrl(metadata.proofObjectKey),
      expiresInSeconds: 300,
    };
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

  async endCall(id: string, adminId: string, reason?: string) {
    const room = await this.prisma.callRoom.findUnique({ where: { id } });
    if (!room) throw new NotFoundException("Call room not found");
    await this.providers.endLiveKitRoom(room.id);
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.callRoom.update({
        where: { id },
        data: { status: "ENDED", endedAt: new Date() },
      });
      await tx.callEvent.create({
        data: {
          roomId: id,
          actorId: adminId,
          type: "ADMIN_TERMINATED",
          payload: {
            reason: reason?.trim().slice(0, 500) || "Administrative action",
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "call.terminate",
          targetType: "call_room",
          targetId: id,
          afterRedacted: { reason: reason?.trim().slice(0, 500) },
          requestId: randomUUID(),
        },
      });
      return ended;
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
      where: { deletedAt: null },
      include: {
        user: { select: { email: true, displayName: true } },
        consentLogs: { orderBy: { acceptedAt: "desc" }, take: 1 },
        images: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ moderationStatus: "asc" }, { createdAt: "desc" }],
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

  async deleteFace(faceId: string, adminId: string, reason?: string) {
    const profile = await this.prisma.faceProfile.findUnique({
      where: { id: faceId },
      include: { images: true },
    });
    if (!profile || profile.deletedAt) {
      throw new NotFoundException("Face profile not found");
    }
    await this.providers.deleteObject(profile.objectKey);
    for (const image of profile.images) {
      if (image.objectKey !== profile.objectKey) {
        await this.providers.deleteObject(image.objectKey);
      }
    }
    if (profile.thumbnailKey)
      await this.providers.deleteObject(profile.thumbnailKey);
    return this.prisma.$transaction(async (tx) => {
      await tx.faceProfileImage.deleteMany({
        where: { faceProfileId: faceId },
      });
      const deleted = await tx.faceProfile.update({
        where: { id: faceId },
        data: {
          deletedAt: new Date(),
          deletionRequestedAt: new Date(),
          consentRevokedAt: new Date(),
          moderationStatus: "REJECTED",
          objectKey: `deleted/${faceId}`,
          thumbnailKey: null,
        },
      });
      await tx.consentLog.updateMany({
        where: { faceProfileId: faceId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorAdminId: adminId,
          action: "face.delete",
          targetType: "face_profile",
          targetId: faceId,
          afterRedacted: { reason: reason?.trim().slice(0, 500) },
          requestId: randomUUID(),
        },
      });
      return deleted;
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
      const purchasedDelta =
        input.amountMilli >= 0
          ? input.amountMilli
          : -Math.min(
              wallet.purchasedMilliCredits,
              Math.abs(input.amountMilli),
            );
      const includedDelta =
        input.amountMilli < 0 ? input.amountMilli - purchasedDelta : 0;
      const updated = await tx.creditWallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          availableMilliCredits: { increment: input.amountMilli },
          purchasedMilliCredits: { increment: purchasedDelta },
          includedMilliCredits: { increment: includedDelta },
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

  async deploymentStatus() {
    const providers = await this.providers.list();
    const environment = [
      "DATABASE_URL",
      "DIRECT_DATABASE_URL",
      "REDIS_URL",
      "APP_URL",
      "API_URL",
      "AUTH_SECRET",
      "SETTINGS_MASTER_KEY",
      "BOOTSTRAP_ADMIN_EMAIL",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ].map((key) => ({ key, configured: Boolean(process.env[key]) }));

    return {
      target: "Emergent",
      nodeEnvironment: process.env.NODE_ENV ?? "development",
      buildCommand: "npm ci && npm run db:generate && npm run build",
      startCommand: "npm run start:deploy",
      environment,
      providers: providers.map((provider) => ({
        provider: provider.provider,
        status: provider.status,
        checkedAt: provider.checkedAt,
        configuredKeys: [
          ...Object.keys(provider.values),
          ...Object.keys(provider.secrets),
        ],
      })),
    };
  }

  async updatePlan(
    id: string,
    adminId: string,
    input: Partial<{
      name: string;
      description: string;
      monthlyCredits: number;
      maxFaceProfiles: number;
      maxImagesPerProfile: number;
      maxParticipants: number;
      maxCallMinutes: number;
      maxGroupCalls: number;
      allowedQualities: Array<"LOW" | "STANDARD" | "HD">;
      watermarkRequired: boolean;
      creditTopupsAllowed: boolean;
      creditResetDays: number;
      groupCalls: boolean;
      voiceEffects: boolean;
      cloudGpu: boolean;
      priceMonthlyMinor: number;
      enabled: boolean;
      providerPriceRefs: object;
      featureAccess: object;
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

  async auditExport() {
    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      records: await this.auditLogs(),
    };
  }
}
