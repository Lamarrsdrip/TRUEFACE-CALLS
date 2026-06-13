import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomsService } from "./rooms.service";

function prismaMock() {
  return {
    user: { findUnique: vi.fn() },
    subscription: { findFirst: vi.fn() },
    callRoom: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    blockedUser: { findFirst: vi.fn() },
    callParticipant: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    callEvent: { create: vi.fn() },
    callHistory: { upsert: vi.fn() },
  };
}

function providersMock() {
  return {
    createLiveKitToken: vi.fn().mockResolvedValue({
      url: "wss://livekit.example.test",
      token: "token",
    }),
    endLiveKitRoom: vi.fn(),
  };
}

describe("RoomsService host and admission flow", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://app.trueface.test";
  });

  it("returns separate guest and host URLs when a host creates a room", async () => {
    const prisma = prismaMock();
    const providers = providersMock();
    const service = new RoomsService(prisma as never, providers as never);

    prisma.user.findUnique.mockResolvedValue({ roomCreationDisabled: false });
    prisma.subscription.findFirst.mockResolvedValue({
      plan: { maxParticipants: 4 },
    });
    prisma.callRoom.create.mockResolvedValue({
      id: "room-1",
      slug: "launch-room",
      title: "Launch room",
      inviteVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
      participants: [
        {
          id: "host-participant",
          userId: "host-1",
          role: "HOST",
          state: "APPROVED",
        },
      ],
    });

    const result = await service.create("host-1", {
      title: "Launch room",
      waitingRoom: true,
      allowGuests: true,
      maxParticipants: 2,
      expiresInMinutes: 60,
    });

    expect(result.inviteUrl).toContain("/call/launch-room?invite=");
    expect(result.hostUrl).toContain("/call/launch-room?invite=");
    expect(result.hostUrl).toContain("host=1");
    expect(result.hostUrl).not.toEqual(result.inviteUrl);
  });

  it("allows the approved host participant to receive a LiveKit token without waiting-room approval", async () => {
    const prisma = prismaMock();
    const providers = providersMock();
    const service = new RoomsService(prisma as never, providers as never);
    const room = { id: "room-1", status: "OPEN", startedAt: null };

    prisma.callParticipant.findFirst.mockResolvedValue({
      id: "host-participant",
      role: "HOST",
      state: "APPROVED",
      livekitIdentity: "user:host-1:abc123",
      user: { displayName: "Host User" },
      room,
    });
    prisma.callRoom.update.mockResolvedValue({
      ...room,
      status: "ACTIVE",
      startedAt: new Date("2026-06-13T12:00:00Z"),
    });
    prisma.callParticipant.update.mockResolvedValue({
      id: "host-participant",
      state: "JOINED",
    });

    await service.userToken("room-1", "host-1");

    expect(providers.createLiveKitToken).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: "room-1",
        identity: "user:host-1:abc123",
        metadata: expect.objectContaining({
          participantId: "host-participant",
          role: "HOST",
        }),
      }),
    );
    expect(prisma.callRoom.update).toHaveBeenCalledWith({
      where: { id: "room-1" },
      data: { status: "ACTIVE", startedAt: expect.any(Date) },
    });
  });

  it("verifies a participant belongs to the room before approving by unique id", async () => {
    const prisma = prismaMock();
    const providers = providersMock();
    const service = new RoomsService(prisma as never, providers as never);

    prisma.callRoom.findUnique.mockResolvedValue({
      id: "room-1",
      hostId: "host-1",
    });
    prisma.callParticipant.findFirst.mockResolvedValue({
      id: "guest-1",
      roomId: "room-1",
      state: "WAITING",
    });
    prisma.callParticipant.update.mockResolvedValue({
      id: "guest-1",
      state: "APPROVED",
    });

    await service.decideParticipant("room-1", "host-1", "guest-1", true);

    expect(prisma.callParticipant.findFirst).toHaveBeenCalledWith({
      where: { id: "guest-1", roomId: "room-1" },
    });
    expect(prisma.callParticipant.update).toHaveBeenCalledWith({
      where: { id: "guest-1" },
      data: { state: "APPROVED" },
    });
  });

  it("does not approve a participant from another room", async () => {
    const prisma = prismaMock();
    const providers = providersMock();
    const service = new RoomsService(prisma as never, providers as never);

    prisma.callRoom.findUnique.mockResolvedValue({
      id: "room-1",
      hostId: "host-1",
    });
    prisma.callParticipant.findFirst.mockResolvedValue(null);

    await expect(
      service.decideParticipant("room-1", "host-1", "guest-elsewhere", true),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.callParticipant.update).not.toHaveBeenCalled();
  });

  it("blocks non-host approval attempts", async () => {
    const prisma = prismaMock();
    const providers = providersMock();
    const service = new RoomsService(prisma as never, providers as never);

    prisma.callRoom.findUnique.mockResolvedValue({
      id: "room-1",
      hostId: "host-1",
    });

    await expect(
      service.decideParticipant("room-1", "other-user", "guest-1", true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
