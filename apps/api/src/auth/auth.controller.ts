import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get("csrf")
  csrf(@Res({ passthrough: true }) response: Response) {
    const csrfToken = randomBytes(24).toString("base64url");
    response.cookie("tf_csrf", csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return { csrfToken };
  }

  @Post("signup")
  async signup(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.signup(body, requestContext(request));
    setSessionCookies(response, result.accessToken, result.refreshToken);
    return stripTokens(result);
  }

  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body, requestContext(request));
    setSessionCookies(response, result.accessToken, result.refreshToken);
    return stripTokens(result);
  }

  @Post("admin-login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async adminLogin(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.adminLogin(body, requestContext(request));
    setSessionCookies(response, result.accessToken, result.refreshToken);
    return stripTokens(result);
  }

  @Post("refresh")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const refreshToken =
      body.refreshToken ??
      (request.cookies as Record<string, string> | undefined)?.tf_refresh;
    if (!refreshToken) {
      return { refreshed: false };
    }
    const result = await this.auth.refresh(
      refreshToken,
      requestContext(request),
    );
    setSessionCookies(response, result.accessToken, result.refreshToken);
    return stripTokens(result);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.user.sessionId);
    clearSessionCookies(response);
    return { loggedOut: true };
  }

  @Post("verify-email")
  verifyEmail(@Body() body: { token: string }) {
    return this.auth.verifyEmail(body.token);
  }

  @Post("forgot-password")
  forgotPassword(@Body() body: { email?: unknown }) {
    return this.auth.forgotPassword(body.email);
  }

  @Post("reset-password")
  resetPassword(@Body() body: { token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Get("session")
  @UseGuards(AuthGuard)
  session(@Req() request: AuthenticatedRequest) {
    return this.auth.session(request.user.sub);
  }

  @Get("account/export")
  @UseGuards(AuthGuard)
  exportAccount(@Req() request: AuthenticatedRequest) {
    return this.auth.exportAccount(request.user.sub);
  }

  @Delete("account")
  @UseGuards(AuthGuard)
  async requestDeletion(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() body: { confirmation?: string },
  ) {
    const result = await this.auth.requestDeletion(
      request.user.sub,
      body.confirmation,
    );
    clearSessionCookies(response);
    return result;
  }
}

function requestContext(request: Request) {
  const ip = request.ip || request.socket.remoteAddress || "";
  const userAgent = request.headers["user-agent"]?.slice(0, 512);
  return {
    ipHash: createHash("sha256").update(ip).digest("hex"),
    ...(userAgent ? { userAgent } : {}),
  };
}

function setSessionCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
) {
  const secure = process.env.NODE_ENV === "production";
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
  response.cookie("tf_access", accessToken, {
    ...common,
    maxAge: 15 * 60 * 1000,
  });
  response.cookie("tf_refresh", refreshToken, {
    ...common,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookies(response: Response) {
  response.clearCookie("tf_access", { path: "/" });
  response.clearCookie("tf_refresh", { path: "/" });
}

function stripTokens<T extends { accessToken: string; refreshToken: string }>(
  result: T,
): Omit<T, "accessToken" | "refreshToken"> {
  const { accessToken: _access, refreshToken: _refresh, ...safe } = result;
  return safe;
}
