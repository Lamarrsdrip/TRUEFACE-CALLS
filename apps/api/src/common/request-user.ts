import type { Request } from "express";

export interface AccessClaims {
  sub: string;
  email: string;
  sessionId: string;
  type: "access";
}

export interface AuthenticatedRequest extends Request {
  user: AccessClaims;
  admin?: {
    id: string;
    role: string;
    permissions: string[];
  };
}
