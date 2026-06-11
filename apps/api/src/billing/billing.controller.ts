import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { BillingService } from "./billing.service";

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  plans() {
    return this.billing.plans();
  }

  @Get("billing/subscription")
  @UseGuards(AuthGuard)
  subscription(@Req() request: AuthenticatedRequest) {
    return this.billing.subscription(request.user.sub);
  }

  @Get("billing/payments")
  @UseGuards(AuthGuard)
  payments(@Req() request: AuthenticatedRequest) {
    return this.billing.payments(request.user.sub);
  }

  @Post("billing/checkout/subscription")
  @UseGuards(AuthGuard)
  subscriptionCheckout(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      provider: "stripe" | "paystack" | "flutterwave";
      planId: string;
    },
  ) {
    return this.billing.createSubscriptionCheckout(request.user.sub, body);
  }

  @Post("billing/checkout/credits")
  @UseGuards(AuthGuard)
  creditCheckout(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      provider: "stripe" | "paystack" | "flutterwave";
      creditsMilli: number;
      amountMinor: number;
      currency: string;
    },
  ) {
    return this.billing.createCreditCheckout(request.user.sub, body);
  }

  @Post("webhooks/stripe")
  stripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ) {
    return this.billing.handleStripe(
      request.rawBody ?? Buffer.from(""),
      signature,
    );
  }

  @Post("webhooks/paystack")
  paystackWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-paystack-signature") signature?: string,
  ) {
    return this.billing.handlePaystack(
      request.rawBody ?? Buffer.from(""),
      signature,
    );
  }

  @Post("webhooks/flutterwave")
  flutterwaveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("verif-hash") signature?: string,
  ) {
    return this.billing.handleFlutterwave(
      request.rawBody ?? Buffer.from(""),
      signature,
    );
  }
}
