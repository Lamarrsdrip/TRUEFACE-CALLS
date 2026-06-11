import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  report(
    reporterId: string,
    input: {
      reportedUserId?: string;
      roomId?: string;
      faceProfileId?: string;
      category: string;
      description: string;
      evidenceObjectKey?: string;
    },
  ) {
    if (!input.reportedUserId && !input.roomId && !input.faceProfileId) {
      throw new ForbiddenException("A report target is required");
    }
    return this.prisma.abuseReport.create({
      data: {
        reporterId,
        ...(input.reportedUserId
          ? { reportedUserId: input.reportedUserId }
          : {}),
        ...(input.roomId ? { roomId: input.roomId } : {}),
        ...(input.faceProfileId ? { faceProfileId: input.faceProfileId } : {}),
        category: input.category.slice(0, 80),
        description: input.description.slice(0, 5_000),
        ...(input.evidenceObjectKey
          ? { evidenceObjectKey: input.evidenceObjectKey }
          : {}),
      },
    });
  }

  blockedUsers(userId: string) {
    return this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async block(userId: string, blockedId: string, reason?: string) {
    if (userId === blockedId) {
      throw new ForbiddenException("You cannot block yourself");
    }
    const target = await this.prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException("User not found");
    }
    const trimmedReason = reason?.slice(0, 500);
    return this.prisma.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId } },
      update: {
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      },
      create: {
        blockerId: userId,
        blockedId,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      },
    });
  }

  async unblock(userId: string, blockedId: string) {
    await this.prisma.blockedUser.deleteMany({
      where: { blockerId: userId, blockedId },
    });
    return { unblocked: true };
  }
}
