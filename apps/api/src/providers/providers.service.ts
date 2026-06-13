import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import Stripe from "stripe";
import { Prisma } from "@trueface/database";
import {
  decryptSetting,
  encryptSetting,
  fingerprintSecret,
  type ProviderTestResult,
} from "@trueface/providers";
import { PrismaService } from "../common/prisma.service";

const SECRET_KEYS = new Set([
  "apiKey",
  "apiSecret",
  "secretKey",
  "webhookSecret",
  "accessKey",
  "secretAccessKey",
  "encryptionKey",
  "webhookHash",
  "clientSecret",
  "password",
  "token",
  "verifyToken",
  "privateKey",
  "dsn",
]);

@Injectable()
export class ProvidersService {
  private readonly masterKey: string;

  constructor(private readonly prisma: PrismaService) {
    const configured = process.env.SETTINGS_MASTER_KEY;
    if (process.env.NODE_ENV === "production" && !configured) {
      throw new Error(
        "SETTINGS_MASTER_KEY is required in production to encrypt provider credentials",
      );
    }
    this.masterKey =
      configured ?? "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  }

  async list() {
    const settings = await this.prisma.appSetting.findMany({
      where: { namespace: { startsWith: "provider:" } },
      orderBy: [{ namespace: "asc" }, { key: "asc" }],
    });
    const health = await this.prisma.providerHealth.findMany();

    const providers = new Map<
      string,
      {
        provider: string;
        values: Record<string, unknown>;
        secrets: Record<string, string>;
        status: string;
        checkedAt: Date | null;
        error: string | null;
      }
    >();

    for (const setting of settings) {
      const provider = setting.namespace.replace("provider:", "");
      const item = providers.get(provider) ?? {
        provider,
        values: {},
        secrets: {},
        status: "UNCONFIGURED",
        checkedAt: null,
        error: null,
      };
      if (setting.encryptedValue) {
        item.secrets[setting.key] = setting.secretFingerprint ?? "configured";
      } else {
        item.values[setting.key] = setting.publicValue;
      }
      providers.set(provider, item);
    }

    for (const item of health) {
      const provider = providers.get(item.provider) ?? {
        provider: item.provider,
        values: {},
        secrets: {},
        status: "UNCONFIGURED",
        checkedAt: null,
        error: null,
      };
      provider.status = item.status;
      provider.checkedAt = item.checkedAt;
      provider.error = item.errorRedacted;
      providers.set(item.provider, provider);
    }

    return [...providers.values()];
  }

  async setProvider(
    provider: string,
    values: Record<string, unknown>,
    updatedById: string,
    actorAdminId: string,
  ) {
    if (!/^[a-z0-9-]{2,32}$/.test(provider)) {
      throw new BadRequestException("Provider key is invalid");
    }

    const operations = Object.entries(values).map(([key, value]) => {
      const isSecret = SECRET_KEYS.has(key);
      if (isSecret && (typeof value !== "string" || value.length < 4)) {
        throw new BadRequestException(`${key} must be a non-empty secret`);
      }

      return this.prisma.appSetting.upsert({
        where: {
          namespace_key: {
            namespace: `provider:${provider}`,
            key,
          },
        },
        update: isSecret
          ? {
              encryptedValue: encryptSetting(String(value), this.masterKey),
              secretFingerprint: fingerprintSecret(String(value)),
              publicValue: Prisma.DbNull,
              updatedById,
              version: { increment: 1 },
            }
          : {
              publicValue: value as object,
              encryptedValue: null,
              secretFingerprint: null,
              updatedById,
              version: { increment: 1 },
            },
        create: isSecret
          ? {
              namespace: `provider:${provider}`,
              key,
              encryptedValue: encryptSetting(String(value), this.masterKey),
              secretFingerprint: fingerprintSecret(String(value)),
              updatedById,
            }
          : {
              namespace: `provider:${provider}`,
              key,
              publicValue: value as object,
              updatedById,
            },
      });
    });

    await this.prisma.$transaction([
      ...operations,
      this.prisma.auditLog.create({
        data: {
          actorAdminId,
          action: "provider.settings.update",
          targetType: "provider",
          targetId: provider,
          afterRedacted: { configuredKeys: Object.keys(values) },
          requestId: crypto.randomUUID(),
        },
      }),
    ]);
    return this.getProvider(provider);
  }

  async getProvider(provider: string): Promise<Record<string, string>> {
    const settings = await this.prisma.appSetting.findMany({
      where: { namespace: `provider:${provider}` },
    });
    const result: Record<string, string> = {};

    for (const setting of settings) {
      if (setting.encryptedValue) {
        result[setting.key] = decryptSetting(
          setting.encryptedValue,
          this.masterKey,
        );
      } else if (setting.publicValue !== null) {
        const value = setting.publicValue;
        result[setting.key] =
          typeof value === "string" ? value : JSON.stringify(value);
      }
    }

    const fallback = providerEnvironment(provider);
    for (const [key, value] of Object.entries(fallback)) {
      if (!(key in result) && value) {
        result[key] = value;
      }
    }
    return result;
  }

  async createLiveKitToken(input: {
    roomName: string;
    identity: string;
    displayName: string;
    metadata: Record<string, unknown>;
    canPublish: boolean;
  }) {
    const start = Date.now();
    const config = await this.getProvider("livekit");
    const { url, apiKey, apiSecret } = config;
    if (!url || !apiKey || !apiSecret) {
      await this.recordProviderHealth(
        "livekit",
        unconfigured("LiveKit is not configured"),
        start,
      );
      throw new ServiceUnavailableException("LiveKit is not configured");
    }

    try {
      const token = new AccessToken(apiKey, apiSecret, {
        identity: input.identity,
        name: input.displayName,
        ttl: "10m",
        metadata: JSON.stringify(input.metadata),
      });
      token.addGrant({
        room: input.roomName,
        roomJoin: true,
        canPublish: input.canPublish,
        canSubscribe: true,
        canPublishData: true,
      });
      const jwt = await token.toJwt();
      await this.recordProviderHealth(
        "livekit",
        operational("LiveKit token generated successfully"),
        start,
      );
      return { url, token: jwt };
    } catch (error) {
      const result: ProviderTestResult = {
        status: "down",
        message: redactError(error),
      };
      await this.recordProviderHealth("livekit", result, start);
      throw error;
    }
  }

  async sendEmail(input: {
    to: string;
    subject: string;
    html: string;
  }): Promise<"sent" | "not-configured" | "failed"> {
    const config = await this.getProvider("email");
    const provider = (config.provider ?? "resend").toLowerCase();
    if (!config.apiKey || !config.from) {
      return "not-configured";
    }
    if (provider !== "resend") {
      return "failed";
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
        }),
      });
      return response.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  }

  async endLiveKitRoom(roomName: string) {
    const config = await this.getProvider("livekit");
    const { url, apiKey, apiSecret } = config;
    if (!url || !apiKey || !apiSecret) {
      return;
    }
    const client = new RoomServiceClient(toHttpUrl(url), apiKey, apiSecret);
    await client.deleteRoom(roomName);
  }

  async createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds?: number;
  }) {
    const { client, bucket } = await this.s3();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ServerSideEncryption: "AES256",
    });
    return {
      url: await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds ?? 300,
      }),
      headers: {
        "content-type": input.contentType,
        "x-amz-server-side-encryption": "AES256",
      },
    };
  }

  async createDownloadUrl(objectKey: string) {
    const { client, bucket } = await this.s3();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 300 },
    );
  }

  async deleteObject(objectKey: string) {
    const { client, bucket } = await this.s3();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
  }

  async test(provider: string): Promise<ProviderTestResult> {
    const start = Date.now();
    let result: ProviderTestResult;
    try {
      if (provider === "livekit") {
        const config = await this.getProvider(provider);
        if (!config.url || !config.apiKey || !config.apiSecret) {
          result = unconfigured("LiveKit URL and API credentials are required");
        } else {
          const client = new RoomServiceClient(
            toHttpUrl(config.url),
            config.apiKey,
            config.apiSecret,
          );
          await client.listRooms();
          result = operational("Connected to LiveKit");
        }
      } else if (provider === "storage") {
        const { client, bucket } = await this.s3();
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        result = operational("Storage bucket is reachable");
      } else if (provider === "stripe") {
        const config = await this.getProvider(provider);
        if (!config.secretKey) {
          result = unconfigured("Stripe secret key is required");
        } else {
          const stripe = new Stripe(config.secretKey);
          await stripe.balance.retrieve();
          result = operational("Connected to Stripe");
        }
      } else {
        const config = await this.getProvider(provider);
        result =
          Object.keys(config).length > 0
            ? operational("Provider credentials are configured")
            : unconfigured("Provider credentials are required");
      }
    } catch (error) {
      result = {
        status: "down",
        message: redactError(error),
      };
    }

    result.latencyMs = Date.now() - start;
    await this.prisma.providerHealth.upsert({
      where: { provider },
      update: {
        status: healthStatus(result.status),
        latencyMs: result.latencyMs,
        errorRedacted:
          result.status === "down" ? result.message.slice(0, 500) : null,
        checkedAt: new Date(),
      },
      create: {
        provider,
        status: healthStatus(result.status),
        latencyMs: result.latencyMs,
        errorRedacted:
          result.status === "down" ? result.message.slice(0, 500) : null,
        checkedAt: new Date(),
      },
    });
    return result;
  }

  private async recordProviderHealth(
    provider: string,
    result: ProviderTestResult,
    start: number,
  ) {
    const latencyMs = Date.now() - start;
    await this.prisma.providerHealth.upsert({
      where: { provider },
      update: {
        status: healthStatus(result.status),
        latencyMs,
        errorRedacted:
          result.status === "down" ? result.message.slice(0, 500) : null,
        checkedAt: new Date(),
      },
      create: {
        provider,
        status: healthStatus(result.status),
        latencyMs,
        errorRedacted:
          result.status === "down" ? result.message.slice(0, 500) : null,
        checkedAt: new Date(),
      },
    });
  }

  private async s3() {
    const config = await this.getProvider("storage");
    if (
      !config.endpoint ||
      !config.bucket ||
      !config.accessKey ||
      !config.secretAccessKey
    ) {
      throw new ServiceUnavailableException("Storage is not configured");
    }
    return {
      bucket: config.bucket,
      client: new S3Client({
        endpoint: config.endpoint,
        region: config.region ?? "auto",
        forcePathStyle: config.forcePathStyle === "true",
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    };
  }
}

function providerEnvironment(
  provider: string,
): Record<string, string | undefined> {
  const values: Record<string, Record<string, string | undefined>> = {
    livekit: {
      url: process.env.LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_API_SECRET,
    },
    storage: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      accessKey: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE,
    },
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY,
      webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
    },
    flutterwave: {
      secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
      encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
      webhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH,
    },
    email: {
      apiKey: process.env.EMAIL_API_KEY,
      from: process.env.EMAIL_FROM,
      provider: process.env.EMAIL_PROVIDER,
    },
  };
  return values[provider] ?? {};
}

function toHttpUrl(url: string) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function operational(message: string): ProviderTestResult {
  return { status: "operational", message };
}

function unconfigured(message: string): ProviderTestResult {
  return { status: "unconfigured", message };
}

function healthStatus(status: ProviderTestResult["status"]) {
  return status.toUpperCase() as
    | "OPERATIONAL"
    | "DEGRADED"
    | "DOWN"
    | "UNCONFIGURED";
}

function redactError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Provider test failed";
  return message.replace(
    /(sk|pk|whsec|api|key|secret)[-_a-z0-9]{8,}/gi,
    "[redacted]",
  );
}
