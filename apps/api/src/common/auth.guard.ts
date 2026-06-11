import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AccessClaims, AuthenticatedRequest } from "./request-user";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    const token =
      bearer ??
      (request.cookies as Record<string, string> | undefined)?.tf_access;

    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token);
      if (claims.type !== "access") {
        throw new Error("Wrong token type");
      }
      (request as AuthenticatedRequest).user = claims;
      return true;
    } catch {
      throw new UnauthorizedException("Session is invalid or expired");
    }
  }
}
