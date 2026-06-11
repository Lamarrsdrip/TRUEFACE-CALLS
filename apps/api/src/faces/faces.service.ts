import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { consentAttestationSchema } from "@trueface/contracts";
import { nanoid } from "nanoid";
import { PrismaService } from "../common/prisma.service";
import { ProvidersService } from "../providers/providers.service";
import { assertFaceProfileCanActivate } from "./face-policy";

interface QualityInput {
  width: number;
  height: number;
  faceCount: number;
  blurScore: number;
  brightness: number;
  faceCoverage: number;
}

@Injectable()
export class FacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  async createUploadUrl(
    userId: string,
    input: { contentType: string; sizeBytes: number },
  ) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)
    ) {
      throw new BadRequestException("JPEG, PNG, or WebP is required");
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > 10 * 1024 * 1024) {
      throw new BadRequestException("Face image must be smaller than 10 MB");
    }
    const extension =
      input.contentType === "image/png"
        ? "png"
        : input.contentType === "image/webp"
          ? "webp"
          : "jpg";
    const objectKey = `faces/${userId}/${nanoid(24)}.${extension}`;
    return {
      objectKey,
      ...(await this.providers.createUploadUrl({
        objectKey,
        contentType: input.contentType,
      })),
    };
  }

  qualityCheck(input: QualityInput) {
    const checks = {
      resolution: input.width >= 512 && input.height >= 512,
      singleFace: input.faceCount === 1,
      sharpness: input.blurScore >= 0.55,
      lighting: input.brightness >= 0.25 && input.brightness <= 0.9,
      faceCoverage: input.faceCoverage >= 0.25 && input.faceCoverage <= 0.8,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return {
      score: passed * 20,
      passed: passed === Object.keys(checks).length,
      checks,
    };
  }

  async create(
    userId: string,
    input: {
      name: string;
      objectKey: string;
      mimeType: string;
      sizeBytes: number;
      width: number;
      height: number;
      quality: QualityInput;
      consent: unknown;
    },
    context: { ipHash?: string; userAgent?: string },
  ) {
    if (!input.objectKey.startsWith(`faces/${userId}/`)) {
      throw new ForbiddenException("Face object does not belong to this user");
    }
    const consent = consentAttestationSchema.parse(input.consent);
    const quality = this.qualityCheck(input.quality);
    if (!quality.passed) {
      throw new BadRequestException({
        message: "Face quality check failed",
        quality,
      });
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ["TRIALING", "ACTIVE"] } },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) {
      throw new ForbiddenException("An active plan is required");
    }
    const profileCount = await this.prisma.faceProfile.count({
      where: { userId, deletedAt: null },
    });
    if (profileCount >= subscription.plan.maxFaceProfiles) {
      throw new ForbiddenException("Your face profile limit has been reached");
    }

    const autoSetting = await this.prisma.appSetting.findUnique({
      where: {
        namespace_key: {
          namespace: "moderation",
          key: "autoApproveQualityProfiles",
        },
      },
    });
    const autoApprove = autoSetting?.publicValue === true;

    const moderationEvents = autoApprove
      ? {
          create: {
            status: "APPROVED" as const,
            reasonCodes: ["AUTO_QUALITY_POLICY"],
            modelSignals: quality,
          },
        }
      : null;

    return this.prisma.faceProfile.create({
      data: {
        userId,
        name: input.name.trim().slice(0, 80),
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        width: input.width,
        height: input.height,
        qualityScore: quality.score,
        qualitySignals: quality,
        moderationStatus: autoApprove ? "APPROVED" : "PENDING",
        consentLogs: {
          create: {
            userId,
            ownsOrHasPermission: consent.ownsOrHasPermission,
            consentsToFaceUse: consent.consentsToFaceUse,
            acceptsFaceTerms: consent.acceptsFaceTerms,
            termsVersion: consent.termsVersion,
            privacyVersion: "2026-06-11",
            ...(context.ipHash ? { ipHash: context.ipHash } : {}),
            ...(context.userAgent ? { userAgent: context.userAgent } : {}),
          },
        },
        ...(moderationEvents ? { moderationEvents } : {}),
      },
      include: { consentLogs: true },
    });
  }

  async list(userId: string) {
    const profiles = await this.prisma.faceProfile.findMany({
      where: { userId, deletedAt: null },
      include: {
        consentLogs: {
          orderBy: { acceptedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        previewUrl: await this.safeDownloadUrl(profile.objectKey),
      })),
    );
  }

  async activate(userId: string, profileId: string) {
    const profile = await this.prisma.faceProfile.findFirst({
      where: { id: profileId, userId },
      include: {
        consentLogs: {
          where: { revokedAt: null },
          orderBy: { acceptedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!profile) {
      throw new NotFoundException("Face profile not found");
    }
    assertFaceProfileCanActivate({
      ...profile,
      consent: profile.consentLogs[0] ?? null,
    });
    return {
      profileId: profile.id,
      faceImageUrl: await this.providers.createDownloadUrl(profile.objectKey),
      consentTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async revoke(userId: string, profileId: string) {
    const profile = await this.prisma.faceProfile.findFirst({
      where: { id: profileId, userId, deletedAt: null },
    });
    if (!profile) {
      throw new NotFoundException("Face profile not found");
    }
    await this.prisma.$transaction([
      this.prisma.faceProfile.update({
        where: { id: profileId },
        data: { consentRevokedAt: new Date() },
      }),
      this.prisma.consentLog.updateMany({
        where: { faceProfileId: profileId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { revoked: true };
  }

  async delete(userId: string, profileId: string) {
    const profile = await this.prisma.faceProfile.findFirst({
      where: { id: profileId, userId, deletedAt: null },
    });
    if (!profile) {
      throw new NotFoundException("Face profile not found");
    }

    await this.prisma.faceProfile.update({
      where: { id: profileId },
      data: { deletionRequestedAt: new Date() },
    });
    await this.providers.deleteObject(profile.objectKey);
    if (profile.thumbnailKey) {
      await this.providers.deleteObject(profile.thumbnailKey);
    }
    await this.prisma.faceProfile.update({
      where: { id: profileId },
      data: {
        deletedAt: new Date(),
        consentRevokedAt: new Date(),
        objectKey: `deleted/${profile.id}`,
        thumbnailKey: null,
      },
    });
    await this.prisma.consentLog.updateMany({
      where: { faceProfileId: profileId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { deleted: true };
  }

  private async safeDownloadUrl(objectKey: string) {
    try {
      return await this.providers.createDownloadUrl(objectKey);
    } catch {
      return null;
    }
  }
}
