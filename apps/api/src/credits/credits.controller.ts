import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { CreditsService } from "./credits.service";

@Controller("credits")
@UseGuards(AuthGuard)
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get("wallet")
  wallet(@Req() request: AuthenticatedRequest) {
    return this.credits.wallet(request.user.sub);
  }

  @Get("transactions")
  transactions(
    @Req() request: AuthenticatedRequest,
    @Query("take") take?: string,
  ) {
    return this.credits.transactions(request.user.sub, Number(take ?? 50));
  }

  @Post("meter/reserve")
  reserve(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      roomId: string;
      amountMilli: number;
      idempotencyKey: string;
    },
  ) {
    return this.credits.reserve({ userId: request.user.sub, ...body });
  }

  @Get("quote")
  quote(
    @Req() request: AuthenticatedRequest,
    @Query("roomId") roomId: string,
    @Query("mode") mode: "BASE_CALL" | "AI_FACE" | "VOICE_EFFECT" | "CLOUD_GPU",
    @Query("quality") quality: "LOW" | "STANDARD" | "HD",
  ) {
    return this.credits.quote(request.user.sub, { roomId, mode, quality });
  }

  @Post("meter/settle")
  settle(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: Omit<Parameters<CreditsService["settle"]>[0], "userId">,
  ) {
    return this.credits.settle({ userId: request.user.sub, ...body });
  }

  @Post("meter/release")
  release(
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      roomId: string;
      amountMilli: number;
      idempotencyKey: string;
    },
  ) {
    return this.credits.release({ userId: request.user.sub, ...body });
  }
}
