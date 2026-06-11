import { createHmac, timingSafeEqual } from "node:crypto";

interface InvitePayload {
  roomId: string;
  inviteVersion: number;
  expiresAt: Date;
}

interface SerializedInvitePayload {
  roomId: string;
  inviteVersion: number;
  exp: number;
}

export class InviteSigner {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error("Invite signing secret must be at least 32 characters");
    }
  }

  sign(payload: InvitePayload): string {
    const body = Buffer.from(
      JSON.stringify({
        roomId: payload.roomId,
        inviteVersion: payload.inviteVersion,
        exp: Math.floor(payload.expiresAt.getTime() / 1000),
      } satisfies SerializedInvitePayload),
    ).toString("base64url");

    return `${body}.${this.signature(body)}`;
  }

  verify(token: string): SerializedInvitePayload {
    const [body, providedSignature] = token.split(".");
    if (!body || !providedSignature) {
      throw new Error("Invite token is malformed");
    }

    const expected = Buffer.from(this.signature(body));
    const provided = Buffer.from(providedSignature);
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new Error("Invite token signature is invalid");
    }

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SerializedInvitePayload;

    if (
      typeof payload.roomId !== "string" ||
      !Number.isInteger(payload.inviteVersion) ||
      !Number.isInteger(payload.exp)
    ) {
      throw new Error("Invite token payload is invalid");
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("Invite token has expired");
    }

    return payload;
  }

  private signature(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}
