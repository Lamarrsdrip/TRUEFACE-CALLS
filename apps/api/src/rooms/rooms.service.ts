import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createRoomSchema } from "@trueface/contracts";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { PrismaService } from "../common/prisma.service";
import { InviteSigner } from "../common/invite-signer";
import { ProvidersService } from "../providers/providers.service";
import { authSecret } from "../common/runtime-config";

@Injectable()
export class RoomsService {
  private readonly signer = new InviteSigner(authSecret());

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  async create(hostId: string, payload: unknown) {
    const input = createRoomSchema.parse(payload);
    const [host, subscription] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: hostId },
        select: { roomCreationDisabled: true },
      }),
      this.prisma.subscription.findFirst({
        where: {
          userId: hostId,
          status: { in: ["TRIALING", "ACTIVE"] },
        },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (host?.roomCreationDisabled) {
      throw new ForbiddenException(
        "Room creation is disabled for this account",
      );
    }
    if (!subscription) {
      throw new ForbiddenException("An active plan is required");
    }
    if (input.maxParticipants > subscription.plan.maxParticipants) {
      throw new ForbiddenException(
        `Your plan supports up to ${subscription.plan.maxParticipants} participants`,
      );
    }

    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);
    const room = await this.prisma.callRoom.create({
      data: {
        hostId,
        slug: nanoid(12),
        title: input.title,
        waitingRoom: input.waitingRoom,
        allowGuests: input.allowGuests,
        maxParticipants: input.maxParticipants,
        expiresAt,
        ...(input.password
          ? {
              passwordHash: await argon2.hash(input.password, {
                type: argon2.argon2id,
              }),
            }
          : {}),
        participants: {
          create: {
            userId: hostId,
            role: "HOST",
            state: "APPROVED",
            livekitIdentity: `user:${hostId}:${nanoid(6)}`,
          },
        },
      },
      include: { participants: true },
    });
    const inviteToken = this.signer.sign({
      roomId: room.id,
      inviteVersion: room.inviteVersion,
      expiresAt,
    });

    return {
      room,
      inviteToken,
      inviteUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/call/${room.slug}?invite=${encodeURIComponent(inviteToken)}`,
    };
  }

  async resolve(slug: string, inviteToken: string) {
    const invite = this.signer.verify(inviteToken);
    const room = await this.prisma.callRoom.findUnique({
      where: { slug },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        waitingRoom: true,
        allowGuests: true,
        maxParticipants: true,
        passwordHash: true,
        inviteVersion: true,
        expiresAt: true,
        _count: { select: { participants: true } },
      },
    });
    if (
      !room ||
      room.id !== invite.roomId ||
      room.inviteVersion !== invite.inviteVersion
    ) {
      throw new NotFoundException("Call invite is invalid");
    }
    if (
      room.expiresAt <= new Date() ||
      ["ENDED", "EXPIRED"].includes(room.status)
    ) {
      throw new BadRequestException("This call link has expired");
    }
    return {
      id: room.id,
      title: room.title,
      slug: room.slug,
      status: room.status,
      waitingRoom: room.waitingRoom,
      allowGuests: room.allowGuests,
      maxParticipants: room.maxParticipants,
      participantCount: room._count.participants,
      passwordRequired: Boolean(room.passwordHash),
      expiresAt: room.expiresAt,
    };
  }

  async requestGuestJoin(
    roomId: string,
    input: {
      inviteToken: string;
      guestName: string;
      password?: string;
    },
  ) {
    const room = await this.assertInvite(roomId, input.inviteToken);
    if (!room.allowGuests) {
      throw new ForbiddenException("Guest joining is disabled");
    }
    await this.assertPassword(room.passwordHash, input.password);

    const guestToken = randomBytes(32).toString("base64url");
    const participant = await this.prisma.callParticipant.create({
      data: {
        roomId,
        guestName: input.guestName.trim().slice(0, 80),
        guestTokenHash: hashToken(guestToken),
        role: "PARTICIPANT",
        state: room.waitingRoom ? "WAITING" : "APPROVED",
        livekitIdentity: `guest:${nanoid(16)}`,
      },
    });
    return {
      participantId: participant.id,
      state: participant.state,
      guestToken,
    };
  }

  async requestUserJoin(
    roomId: string,
    userId: string,
    input: { inviteToken: string; password?: string },
  ) {
    const room = await this.assertInvite(roomId, input.inviteToken);
    await this.assertPassword(room.passwordHash, input.password);
    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: room.hostId, blockedId: userId },
          { blockerId: userId, blockedId: room.hostId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException("Joining is not permitted");
    }
    return this.prisma.callParticipant.upsert({
      where: {
        id:
          (
            await this.prisma.callParticipant.findFirst({
              where: { roomId, userId },
              select: { id: true },
            })
          )?.id ?? "00000000-0000-0000-0000-000000000000",
      },
      update: {
        state: room.waitingRoom ? "WAITING" : "APPROVED",
      },
      create: {
        roomId,
        userId,
        role: "PARTICIPANT",
        state: room.waitingRoom ? "WAITING" : "APPROVED",
        livekitIdentity: `user:${userId}:${nanoid(6)}`,
      },
    });
  }

  async waitingRoom(roomId: string, hostId: string) {
    await this.assertHost(roomId, hostId);
    return this.prisma.callParticipant.findMany({
      where: { roomId, state: "WAITING" },
      include: {
        user: {
          select: { id: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async decideParticipant(
    roomId: string,
    hostId: string,
    participantId: string,
    approve: boolean,
  ) {
    await this.assertHost(roomId, hostId);
    return this.prisma.callParticipant.update({
      where: { id: participantId, roomId },
      data: { state: approve ? "APPROVED" : "REJECTED" },
    });
  }

  async userToken(roomId: string, userId: string) {
    const participant = await this.prisma.callParticipant.findFirst({
      where: { roomId, userId, state: { in: ["APPROVED", "JOINED"] } },
      include: { room: true, user: true },
    });
    if (!participant?.livekitIdentity || !participant.user) {
      throw new ForbiddenException("Participant is not approved");
    }
    await this.prisma.callParticipant.update({
      where: { id: participant.id },
      data: { state: "JOINED", joinedAt: new Date() },
    });
    return this.providers.createLiveKitToken({
      roomName: roomId,
      identity: participant.livekitIdentity,
      displayName: participant.user.displayName,
      metadata: {
        participantId: participant.id,
        role: participant.role,
        aiFaceActive: false,
      },
      canPublish: true,
    });
  }

  async guestToken(
    roomId: string,
    input: { participantId: string; guestToken: string },
  ) {
    const participant = await this.prisma.callParticipant.findFirst({
      where: {
        id: input.participantId,
        roomId,
        state: { in: ["APPROVED", "JOINED"] },
      },
    });
    if (
      !participant?.guestTokenHash ||
      !participant.livekitIdentity ||
      hashToken(input.guestToken) !== participant.guestTokenHash
    ) {
      throw new ForbiddenException("Guest access is invalid");
    }
    await this.prisma.callParticipant.update({
      where: { id: participant.id },
      data: { state: "JOINED", joinedAt: new Date() },
    });
    return this.providers.createLiveKitToken({
      roomName: roomId,
      identity: participant.livekitIdentity,
      displayName: participant.guestName ?? "Guest",
      metadata: {
        participantId: participant.id,
        role: participant.role,
        aiFaceActive: false,
        guest: true,
      },
      canPublish: true,
    });
  }

  async end(roomId: string, hostId: string) {
    await this.assertHost(roomId, hostId);
    const room = await this.prisma.callRoom.update({
      where: { id: roomId },
      data: { status: "ENDED", endedAt: new Date() },
      include: { participants: true },
    });
    await this.providers.endLiveKitRoom(roomId);
    if (room.startedAt) {
      await this.prisma.callHistory.upsert({
        where: { roomId },
        update: {
          endedAt: room.endedAt ?? new Date(),
          participantCount: room.participants.length,
          terminationReason: "host_ended",
        },
        create: {
          roomId,
          startedAt: room.startedAt,
          endedAt: room.endedAt ?? new Date(),
          participantCount: room.participants.length,
          terminationReason: "host_ended",
        },
      });
    }
    return { ended: true };
  }

  async history(userId: string) {
    return this.prisma.callRoom.findMany({
      where: {
        OR: [{ hostId: userId }, { participants: { some: { userId } } }],
      },
      include: {
        history: true,
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async userRooms(userId: string) {
    const rooms = await this.prisma.callRoom.findMany({
      where: {
        OR: [{ hostId: userId }, { participants: { some: { userId } } }],
      },
      include: {
        host: { select: { displayName: true, email: true } },
        history: true,
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rooms.map((room) => {
      const isHost = room.hostId === userId;
      const inviteToken = isHost
        ? this.signer.sign({
            roomId: room.id,
            inviteVersion: room.inviteVersion,
            expiresAt: room.expiresAt,
          })
        : null;
      return {
        ...room,
        isHost,
        inviteUrl: inviteToken
          ? `${process.env.APP_URL ?? "http://localhost:3000"}/call/${room.slug}?invite=${encodeURIComponent(inviteToken)}`
          : null,
      };
    });
  }

  private async assertInvite(roomId: string, token: string) {
    const invite = this.signer.verify(token);
    const room = await this.prisma.callRoom.findUnique({
      where: { id: roomId },
    });
    if (
      !room ||
      invite.roomId !== room.id ||
      invite.inviteVersion !== room.inviteVersion ||
      room.expiresAt <= new Date()
    ) {
      throw new ForbiddenException("Call invite is invalid");
    }
    return room;
  }

  private async assertHost(roomId: string, userId: string) {
    const room = await this.prisma.callRoom.findUnique({
      where: { id: roomId },
    });
    if (!room || room.hostId !== userId) {
      throw new ForbiddenException("Host permission required");
    }
    return room;
  }

  private async assertPassword(
    passwordHash: string | null,
    password: string | undefined,
  ) {
    if (
      passwordHash &&
      (!password || !(await argon2.verify(passwordHash, password)))
    ) {
      throw new ForbiddenException("Room password is incorrect");
    }
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
