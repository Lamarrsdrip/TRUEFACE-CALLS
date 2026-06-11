import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function parseMasterKey(masterKey: string): Buffer {
  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) {
    throw new Error("SETTINGS_MASTER_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function encryptSetting(value: string, masterKey: string): string {
  const key = parseMasterKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSetting(payload: string, masterKey: string): string {
  const [version, ivEncoded, tagEncoded, encryptedEncoded] = payload.split(".");

  if (version !== VERSION || !ivEncoded || !tagEncoded || !encryptedEncoded) {
    throw new Error("Encrypted setting payload is invalid");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    parseMasterKey(masterKey),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintSecret(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").toUpperCase();
  return `...${digest.slice(-4)}`;
}

export type ProviderValueSource = "admin" | "environment" | "unconfigured";

export function resolveProviderValue(input: {
  encryptedAdminValue: string | null;
  environmentValue: string | undefined;
  masterKey: string;
}): { value: string | null; source: ProviderValueSource } {
  if (input.encryptedAdminValue) {
    return {
      value: decryptSetting(input.encryptedAdminValue, input.masterKey),
      source: "admin",
    };
  }

  if (input.environmentValue) {
    return { value: input.environmentValue, source: "environment" };
  }

  return { value: null, source: "unconfigured" };
}

export interface ProviderTestResult {
  status: "operational" | "degraded" | "down" | "unconfigured";
  latencyMs?: number;
  message: string;
}

export interface CheckoutRequest {
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
  amountMinor: number;
  currency: string;
  externalPriceId?: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CheckoutResult {
  externalReference: string;
  checkoutUrl: string;
}

export interface PaymentAdapter {
  readonly provider: "stripe" | "paystack" | "flutterwave";
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<VerifiedPaymentEvent>;
  testConnection(): Promise<ProviderTestResult>;
}

export interface VerifiedPaymentEvent {
  id: string;
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "subscription.updated"
    | "refund.updated";
  externalReference: string;
  status: string;
  amountMinor?: number;
  currency?: string;
  metadata: Record<string, string>;
}

export interface StorageAdapter {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  createDownloadUrl(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string>;
  deleteObject(objectKey: string): Promise<void>;
  testConnection(): Promise<ProviderTestResult>;
}

export interface VideoProviderAdapter {
  createParticipantToken(input: {
    roomName: string;
    identity: string;
    displayName: string;
    metadata: Record<string, unknown>;
    canPublish: boolean;
    canSubscribe: boolean;
    expiresInSeconds: number;
  }): Promise<string>;
  endRoom(roomName: string): Promise<void>;
  testConnection(): Promise<ProviderTestResult>;
}

export interface GpuProcessingAdapter {
  readonly provider: "runpod" | "modal" | "aws" | "replicate" | "custom";
  createSession(input: {
    roomId: string;
    participantId: string;
    quality: "low" | "standard" | "hd";
  }): Promise<{ sessionId: string; signalingUrl: string }>;
  endSession(sessionId: string): Promise<void>;
  testConnection(): Promise<ProviderTestResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}
