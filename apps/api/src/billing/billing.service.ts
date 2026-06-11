import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { PrismaService } from "../common/prisma.service";
import { ProvidersService } from "../providers/providers.service";

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  plans() {
    return this.prisma.plan.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  subscription(userId: string) {
    return this.prisma.subscription.findFirst({
      where: { userId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
  }

  payments(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      include: { refunds: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async createSubscriptionCheckout(
    userId: string,
    input: { provider: "stripe" | "paystack" | "flutterwave"; planId: string },
  ) {
    const [user, plan] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.plan.findUnique({ where: { id: input.planId } }),
    ]);
    if (!user || !plan?.enabled) {
      throw new NotFoundException("User or plan not found");
    }
    if (plan.priceMonthlyMinor <= 0) {
      throw new BadRequestException("This plan does not require checkout");
    }

    const reference = `sub_${crypto.randomUUID()}`;
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: input.provider.toUpperCase() as
          | "STRIPE"
          | "PAYSTACK"
          | "FLUTTERWAVE",
        type: "SUBSCRIPTION",
        amountMinor: plan.priceMonthlyMinor,
        currency: plan.currency,
        status: "PENDING",
        externalReference: reference,
        idempotencyKey: reference,
        metadata: { planId: plan.id, planKey: plan.key },
      },
    });

    return this.initializeCheckout({
      provider: input.provider,
      reference,
      email: user.email,
      amountMinor: plan.priceMonthlyMinor,
      currency: plan.currency,
      description: `${plan.name} monthly subscription`,
      paymentId: payment.id,
      metadata: {
        paymentId: payment.id,
        userId,
        planId: plan.id,
        type: "subscription",
      },
      providerPriceRefs: plan.providerPriceRefs,
    });
  }

  async createCreditCheckout(
    userId: string,
    input: {
      provider: "stripe" | "paystack" | "flutterwave";
      creditsMilli: number;
      amountMinor: number;
      currency: string;
    },
  ) {
    if (
      !Number.isInteger(input.creditsMilli) ||
      input.creditsMilli < 1_000 ||
      !Number.isInteger(input.amountMinor) ||
      input.amountMinor < 100
    ) {
      throw new BadRequestException("Credit purchase amount is invalid");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const reference = `credits_${crypto.randomUUID()}`;
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: input.provider.toUpperCase() as
          | "STRIPE"
          | "PAYSTACK"
          | "FLUTTERWAVE",
        type: "CREDIT_PURCHASE",
        amountMinor: input.amountMinor,
        currency: input.currency.toUpperCase(),
        creditsMilli: input.creditsMilli,
        status: "PENDING",
        externalReference: reference,
        idempotencyKey: reference,
        metadata: { creditsMilli: input.creditsMilli },
      },
    });
    return this.initializeCheckout({
      provider: input.provider,
      reference,
      email: user.email,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      description: `${input.creditsMilli / 1000} TrueFace call credits`,
      paymentId: payment.id,
      metadata: {
        paymentId: payment.id,
        userId,
        creditsMilli: String(input.creditsMilli),
        type: "credits",
      },
    });
  }

  async handleStripe(rawBody: Buffer, signature: string | undefined) {
    const config = await this.providers.getProvider("stripe");
    if (!config.secretKey || !config.webhookSecret || !signature) {
      throw new ServiceUnavailableException("Stripe webhook is not configured");
    }
    const stripe = new Stripe(config.secretKey);
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret,
    );
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await this.settlePayment(
        session.metadata?.paymentId,
        session.id,
        session.subscription?.toString(),
      );
    } else if (event.type === "checkout.session.expired") {
      await this.failPayment(event.data.object.metadata?.paymentId);
    }
    return { received: true };
  }

  async handlePaystack(rawBody: Buffer, signature: string | undefined) {
    const config = await this.providers.getProvider("paystack");
    if (!config.secretKey || !signature) {
      throw new ServiceUnavailableException(
        "Paystack webhook is not configured",
      );
    }
    const expected = createHmac("sha512", config.secretKey)
      .update(rawBody)
      .digest("hex");
    if (!safeEqual(expected, signature)) {
      throw new BadRequestException("Paystack signature is invalid");
    }
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event: string;
      data?: {
        reference?: string;
        metadata?: { paymentId?: string };
        status?: string;
      };
    };
    if (event.event === "charge.success") {
      await this.settlePayment(
        event.data?.metadata?.paymentId,
        event.data?.reference,
      );
    }
    return { received: true };
  }

  async handleFlutterwave(rawBody: Buffer, signature: string | undefined) {
    const config = await this.providers.getProvider("flutterwave");
    if (
      !config.webhookHash ||
      !signature ||
      !safeEqual(config.webhookHash, signature)
    ) {
      throw new BadRequestException("Flutterwave signature is invalid");
    }
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event?: string;
      data?: {
        tx_ref?: string;
        status?: string;
        meta?: { paymentId?: string };
      };
    };
    if (
      event.event === "charge.completed" &&
      event.data?.status === "successful"
    ) {
      await this.settlePayment(event.data.meta?.paymentId, event.data.tx_ref);
    }
    return { received: true };
  }

  private async initializeCheckout(input: {
    provider: "stripe" | "paystack" | "flutterwave";
    reference: string;
    email: string;
    amountMinor: number;
    currency: string;
    description: string;
    paymentId: string;
    metadata: Record<string, string>;
    providerPriceRefs?: unknown;
  }) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const config = await this.providers.getProvider(input.provider);

    if (input.provider === "stripe") {
      if (!config.secretKey) {
        throw new ServiceUnavailableException("Stripe is not configured");
      }
      const stripe = new Stripe(config.secretKey);
      const priceRefs =
        input.providerPriceRefs && typeof input.providerPriceRefs === "object"
          ? (input.providerPriceRefs as Record<string, string>)
          : {};
      const isSubscription = input.metadata.type === "subscription";
      const session = await stripe.checkout.sessions.create(
        {
          mode: isSubscription ? "subscription" : "payment",
          customer_email: input.email,
          client_reference_id: input.reference,
          success_url: `${appUrl}/billing?checkout=success`,
          cancel_url: `${appUrl}/billing?checkout=canceled`,
          metadata: input.metadata,
          line_items:
            isSubscription && priceRefs.stripe
              ? [{ price: priceRefs.stripe, quantity: 1 }]
              : [
                  {
                    price_data: {
                      currency: input.currency.toLowerCase(),
                      unit_amount: input.amountMinor,
                      product_data: { name: input.description },
                      ...(isSubscription
                        ? { recurring: { interval: "month" as const } }
                        : {}),
                    },
                    quantity: 1,
                  },
                ],
        },
        { idempotencyKey: input.reference },
      );
      if (!session.url) {
        throw new ServiceUnavailableException("Stripe did not return a URL");
      }
      return { provider: input.provider, checkoutUrl: session.url };
    }

    if (input.provider === "paystack") {
      if (!config.secretKey) {
        throw new ServiceUnavailableException("Paystack is not configured");
      }
      const response = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.secretKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: input.email,
            amount: input.amountMinor,
            currency: input.currency,
            reference: input.reference,
            callback_url: `${appUrl}/billing?checkout=success`,
            metadata: input.metadata,
          }),
        },
      );
      const payload = (await response.json()) as {
        status: boolean;
        message?: string;
        data?: { authorization_url?: string };
      };
      if (!response.ok || !payload.data?.authorization_url) {
        throw new ServiceUnavailableException(
          payload.message ?? "Paystack checkout failed",
        );
      }
      return {
        provider: input.provider,
        checkoutUrl: payload.data.authorization_url,
      };
    }

    if (!config.secretKey) {
      throw new ServiceUnavailableException("Flutterwave is not configured");
    }
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amountMinor / 100,
        currency: input.currency,
        redirect_url: `${appUrl}/billing?checkout=success`,
        customer: { email: input.email },
        customizations: {
          title: "TrueFace Calls",
          description: input.description,
        },
        meta: input.metadata,
      }),
    });
    const payload = (await response.json()) as {
      status: string;
      message?: string;
      data?: { link?: string };
    };
    if (!response.ok || !payload.data?.link) {
      throw new ServiceUnavailableException(
        payload.message ?? "Flutterwave checkout failed",
      );
    }
    return { provider: input.provider, checkoutUrl: payload.data.link };
  }

  private async settlePayment(
    paymentId: string | undefined,
    externalReference?: string,
    externalSubscriptionId?: string,
  ) {
    if (!paymentId) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
      });
      if (!payment || payment.status === "SUCCEEDED") {
        return;
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          ...(externalReference ? { externalReference } : {}),
        },
      });

      if (payment.type === "CREDIT_PURCHASE" && payment.creditsMilli) {
        const wallet = await tx.creditWallet.findUnique({
          where: { userId: payment.userId },
        });
        if (!wallet) {
          throw new Error("Credit wallet not found");
        }
        const updated = await tx.creditWallet.update({
          where: { id: wallet.id, version: wallet.version },
          data: {
            availableMilliCredits: { increment: payment.creditsMilli },
            lifetimePurchasedMilli: { increment: payment.creditsMilli },
            version: { increment: 1 },
          },
        });
        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            paymentId: payment.id,
            type: "PURCHASE",
            amountMilli: payment.creditsMilli,
            balanceAfterMilli: updated.availableMilliCredits,
            source: payment.provider.toLowerCase(),
            idempotencyKey: `payment:${payment.id}`,
          },
        });
      } else if (payment.type === "SUBSCRIPTION") {
        const metadata =
          payment.metadata && typeof payment.metadata === "object"
            ? (payment.metadata as Record<string, string>)
            : {};
        if (metadata.planId) {
          await tx.subscription.updateMany({
            where: {
              userId: payment.userId,
              status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] },
            },
            data: { status: "CANCELED", canceledAt: new Date() },
          });
          await tx.subscription.create({
            data: {
              userId: payment.userId,
              planId: metadata.planId,
              provider: payment.provider,
              status: "ACTIVE",
              ...(externalSubscriptionId ? { externalSubscriptionId } : {}),
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
        }
      }
    });
  }

  private async failPayment(paymentId: string | undefined) {
    if (!paymentId) return;
    await this.prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "FAILED" },
    });
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
