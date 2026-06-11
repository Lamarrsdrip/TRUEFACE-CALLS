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
      images?: Array<{
        objectKey: string;
        role: "FRONT" | "LEFT" | "RIGHT" | "LIGHTING" | "EXPRESSION";
        mimeType: string;
        sizeBytes: number;
        width: number;
        height: number;
        quality: QualityInput;
      }>;
      consent: unknown;
    },
    context: { ipHash?: string; userAgent?: string },
  ) {
    const consent = consentAttestationSchema.parse(input.consent);
    const submittedImages = input.images?.length
      ? input.images
      : [
          {
            objectKey: input.objectKey,
            role: "FRONT" as const,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            width: input.width,
            height: input.height,
            quality: input.quality,
          },
        ];

    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ["TRIALING", "ACTIVE"] } },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) {
      throw new ForbiddenException("An active plan is required");
    }
    if (submittedImages.length > subscription.plan.maxImagesPerProfile) {
      throw new ForbiddenException(
        `Your plan supports ${subscription.plan.maxImagesPerProfile} images per profile`,
      );
    }
    if (!submittedImages.some((image) => image.role === "FRONT")) {
      throw new BadRequestException("A front-facing image is required");
    }
    const analyzedImages = submittedImages.map((image) => {
      if (!image.objectKey.startsWith(`faces/${userId}/`)) {
        throw new ForbiddenException(
          "A face object does not belong to this user",
        );
      }
      const quality = this.qualityCheck(image.quality);
      if (!quality.passed) {
        throw new BadRequestException({
          message: `The ${image.role.toLowerCase()} image failed quality checks`,
          quality,
        });
      }
      return { ...image, quality };
    });
    const primary =
      analyzedImages.find((image) => image.role === "FRONT") ??
      analyzedImages[0]!;
    const readiness = profileReadiness(analyzedImages);
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
            modelSignals: {
              readiness,
              images: analyzedImages.map((image) => ({
                role: image.role,
                quality: image.quality,
              })),
            },
          },
        }
      : null;

    return this.prisma.faceProfile.create({
      data: {
        userId,
        name: input.name.trim().slice(0, 80),
        objectKey: primary.objectKey,
        mimeType: primary.mimeType,
        sizeBytes: primary.sizeBytes,
        width: primary.width,
        height: primary.height,
        qualityScore: primary.quality.score,
        qualitySignals: primary.quality,
        readinessScore: readiness.score,
        readinessLabel: readiness.label,
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
        images: {
          create: analyzedImages.map((image) => ({
            objectKey: image.objectKey,
            role: image.role,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            width: image.width,
            height: image.height,
            qualityScore: image.quality.score,
            qualitySignals: image.quality,
          })),
        },
      },
      include: { consentLogs: true, images: true },
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
        images: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      profiles.map(async (profile) => ({
        ...profile,
        previewUrl: await this.safeDownloadUrl(profile.objectKey),
        images: await Promise.all(
          profile.images.map(async (image) => ({
            ...image,
            previewUrl: await this.safeDownloadUrl(image.objectKey),
          })),
        ),
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
    if (!profile || !profile.active) {
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

  async setActive(userId: string, profileId: string, active: boolean) {
    const profile = await this.prisma.faceProfile.findFirst({
      where: { id: profileId, userId, deletedAt: null },
    });
    if (!profile) throw new NotFoundException("Face profile not found");
    return this.prisma.faceProfile.update({
      where: { id: profileId },
      data: { active },
    });
  }

  async delete(userId: string, profileId: string) {
    const profile = await this.prisma.faceProfile.findFirst({
      where: { id: profileId, userId, deletedAt: null },
      include: { images: true },
    });
    if (!profile) {
      throw new NotFoundException("Face profile not found");
    }

    await this.prisma.faceProfile.update({
      where: { id: profileId },
      data: { deletionRequestedAt: new Date() },
    });
    await this.providers.deleteObject(profile.objectKey);
    for (const image of profile.images) {
      if (image.objectKey !== profile.objectKey) {
        await this.providers.deleteObject(image.objectKey);
      }
    }
    if (profile.thumbnailKey) {
      await this.providers.deleteObject(profile.thumbnailKey);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.faceProfileImage.deleteMany({
        where: { faceProfileId: profileId },
      });
      await tx.faceProfile.update({
        where: { id: profileId },
        data: {
          deletedAt: new Date(),
          consentRevokedAt: new Date(),
          objectKey: `deleted/${profile.id}`,
          thumbnailKey: null,
        },
      });
      await tx.consentLog.updateMany({
        where: { faceProfileId: profileId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
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

function profileReadiness(
  images: Array<{
    role: string;
    quality: { score: number };
  }>,
) {
  const average =
    images.reduce((sum, image) => sum + image.quality.score, 0) / images.length;
  const roles = new Set(images.map((image) => image.role));
  const diversityBonus = Math.min(20, Math.max(0, roles.size - 1) * 5);
  const volumeBonus = Math.min(10, Math.max(0, images.length - 1) * 2.5);
  const score = Math.min(
    100,
    Math.round(average * 0.7 + diversityBonus + volumeBonus),
  );
  const label =
    score >= 90
      ? "EXCELLENT"
      : score >= 75
        ? "GOOD"
        : score >= 55
          ? "FAIR"
          : "POOR";
  return { score, label };
}
