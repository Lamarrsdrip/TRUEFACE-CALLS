import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  AuthTokenType,
  PaymentProvider,
  SubscriptionStatus,
  UserStatus,
} from "@trueface/database";
import { loginSchema, signupSchema } from "@trueface/contracts";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { ProvidersService } from "../providers/providers.service";

interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly providers: ProvidersService,
  ) {}

  async signup(
    payload: unknown,
    context: { ipHash?: string; userAgent?: string },
  ) {
    const input = signupSchema.parse(payload);
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const trialPlan = await this.prisma.plan.findUnique({
      where: { key: "trial" },
    });
    if (!trialPlan) {
      throw new NotFoundException("Trial plan is not configured");
    }

    const verificationToken = randomBytes(32).toString("base64url");
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          displayName: input.displayName,
          passwordHash,
          creditWallet: {
            create: {
              availableMilliCredits: trialPlan.monthlyCredits,
            },
          },
          subscriptions: {
            create: {
              planId: trialPlan.id,
              provider: PaymentProvider.MANUAL,
              status: SubscriptionStatus.TRIALING,
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          },
          authTokens: {
            create: {
              type: AuthTokenType.EMAIL_VERIFICATION,
              tokenHash: hashToken(verificationToken),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          },
        },
        include: { creditWallet: true },
      });

      if (!created.creditWallet) {
        throw new Error("Credit wallet was not created");
      }

      await tx.creditTransaction.create({
        data: {
          walletId: created.creditWallet.id,
          type: "TRIAL_GRANT",
          amountMilli: trialPlan.monthlyCredits,
          balanceAfterMilli: trialPlan.monthlyCredits,
          source: "signup",
          idempotencyKey: `trial:${created.id}`,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return created;
    });

    const tokens = await this.createSession(user, context);
    const delivery = await this.providers.sendEmail({
      to: user.email,
      subject: "Verify your TrueFace Calls email",
      html: `<p>Verify your email to finish setting up TrueFace Calls.</p><p><a href="${appUrl()}/verify-email?token=${encodeURIComponent(verificationToken)}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
    });
    return {
      user: publicUser(user),
      ...tokens,
      verification: {
        required: true,
        delivery,
        ...(process.env.NODE_ENV !== "production"
          ? { developmentToken: verificationToken }
          : {}),
      },
    };
  }

  async login(
    payload: unknown,
    context: { ipHash?: string; userAgent?: string },
  ) {
    const input = loginSchema.parse(payload);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !(await argon2.verify(user.passwordHash, input.password))
    ) {
      throw new UnauthorizedException("Email or password is incorrect");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      user: publicUser(user),
      ...(await this.createSession(user, context)),
    };
  }

  async refresh(
    refreshToken: string,
    context: { ipHash?: string; userAgent?: string },
  ) {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      include: { user: true },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException("Refresh session is invalid");
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return {
      user: publicUser(session.user),
      ...(await this.createSession(session.user, {
        ...context,
        rotatedFromId: session.id,
      })),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string) {
    const authToken = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (
      !authToken ||
      authToken.type !== AuthTokenType.EMAIL_VERIFICATION ||
      authToken.usedAt ||
      authToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        "Verification token is invalid or expired",
      );
    }

    await this.prisma.$transaction([
      this.prisma.authToken.update({
        where: { id: authToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: authToken.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return { verified: true };
  }

  async forgotPassword(emailValue: unknown) {
    const email =
      typeof emailValue === "string" ? emailValue.toLowerCase() : "";
    const user = await this.prisma.user.findUnique({ where: { email } });
    let developmentToken: string | undefined;

    if (user?.status === UserStatus.ACTIVE) {
      const token = randomBytes(32).toString("base64url");
      developmentToken =
        process.env.NODE_ENV !== "production" ? token : undefined;
      await this.prisma.authToken.create({
        data: {
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await this.providers.sendEmail({
        to: user.email,
        subject: "Reset your TrueFace Calls password",
        html: `<p>A password reset was requested for your account.</p><p><a href="${appUrl()}/reset-password?token=${encodeURIComponent(token)}">Reset password</a></p><p>This link expires in one hour. Ignore this email if you did not request it.</p>`,
      });
    }

    return {
      accepted: true,
      delivery: "sent-if-account-exists",
      ...(developmentToken ? { developmentToken } : {}),
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const parsed = signupSchema.shape.password.safeParse(newPassword);
    if (!parsed.success) {
      throw parsed.error;
    }

    const authToken = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !authToken ||
      authToken.type !== AuthTokenType.PASSWORD_RESET ||
      authToken.usedAt ||
      authToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException("Reset token is invalid or expired");
    }

    const passwordHash = await argon2.hash(parsed.data, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: authToken.userId },
        data: { passwordHash },
      }),
      this.prisma.authToken.update({
        where: { id: authToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: authToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { reset: true };
  }

  async session(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        emailVerifiedAt: true,
        status: true,
        adminProfile: {
          select: { role: true, permissions: true, active: true },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async exportAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        locale: true,
        timezone: true,
        createdAt: true,
        faceProfiles: {
          select: {
            id: true,
            name: true,
            moderationStatus: true,
            createdAt: true,
            deletedAt: true,
          },
        },
        consentLogs: {
          select: {
            id: true,
            faceProfileId: true,
            termsVersion: true,
            acceptedAt: true,
            revokedAt: true,
          },
        },
        callParticipants: {
          select: {
            roomId: true,
            role: true,
            state: true,
            joinedAt: true,
            leftAt: true,
          },
        },
        subscriptions: {
          select: {
            status: true,
            provider: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            createdAt: true,
          },
        },
        payments: {
          select: {
            provider: true,
            type: true,
            status: true,
            amountMinor: true,
            currency: true,
            createdAt: true,
          },
        },
        reportsFiled: {
          select: {
            id: true,
            category: true,
            description: true,
            status: true,
            resolution: true,
            createdAt: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException("Account not found");
    }
    return {
      generatedAt: new Date().toISOString(),
      formatVersion: 1,
      account: user,
    };
  }

  async requestDeletion(userId: string, confirmation?: string) {
    if (confirmation !== "DELETE") {
      throw new BadRequestException("Type DELETE to confirm account deletion");
    }
    const deletionScheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.DELETION_PENDING,
          deletionScheduledAt,
        },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.notification.create({
        data: {
          userId,
          audience: "USER",
          channel: "IN_APP",
          title: "Account deletion scheduled",
          body: `Your account is scheduled for deletion on ${deletionScheduledAt.toISOString()}. Contact support before then to cancel.`,
        },
      }),
    ]);
    return { deletionScheduledAt };
  }

  private async createSession(
    user: SessionUser,
    context: {
      ipHash?: string;
      userAgent?: string;
      rotatedFromId?: string;
    },
  ) {
    const refreshToken = randomBytes(48).toString("base64url");
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        ...(context.ipHash ? { ipHash: context.ipHash } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(context.rotatedFromId
          ? { rotatedFromId: context.rotatedFromId }
          : {}),
      },
    });

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        sessionId: session.id,
        type: "access",
      },
      { expiresIn: "15m" },
    );

    return { accessToken, refreshToken };
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
