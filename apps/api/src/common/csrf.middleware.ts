import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      request.path.includes("/webhooks/") ||
      request.path.endsWith("/health")
    ) {
      next();
      return;
    }

    const cookie = (request.cookies as Record<string, string> | undefined)
      ?.tf_csrf;
    const header = request.headers["x-csrf-token"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!cookie || !provided || !safeEqual(cookie, provided)) {
      response.status(403).json({
        statusCode: 403,
        message: "CSRF token is missing or invalid",
      });
      return;
    }
    next();
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
