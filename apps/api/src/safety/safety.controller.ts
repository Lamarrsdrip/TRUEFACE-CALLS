import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { SafetyService } from "./safety.service";

@Controller()
@UseGuards(AuthGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post("abuse-reports")
  report(
    @Req() request: AuthenticatedRequest,
    @Body() body: Parameters<SafetyService["report"]>[1],
  ) {
    return this.safety.report(request.user.sub, body);
  }

  @Get("me/blocked-users")
  blocked(@Req() request: AuthenticatedRequest) {
    return this.safety.blockedUsers(request.user.sub);
  }

  @Post("me/blocked-users/:userId")
  block(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() body: { reason?: string },
  ) {
    return this.safety.block(request.user.sub, userId, body.reason);
  }

  @Delete("me/blocked-users/:userId")
  unblock(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
  ) {
    return this.safety.unblock(request.user.sub, userId);
  }
}
