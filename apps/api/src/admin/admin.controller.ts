import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../common/admin.guard";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview() {
    return this.admin.overview();
  }

  @Get("users")
  users() {
    return this.admin.users();
  }

  @Patch("users/:id/status")
  updateUser(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { status: "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" },
  ) {
    return this.admin.updateUserStatus(id, request.admin!.id, body.status);
  }

  @Get("subscriptions")
  subscriptions() {
    return this.admin.subscriptions();
  }

  @Get("payments")
  payments() {
    return this.admin.payments();
  }

  @Get("calls")
  calls() {
    return this.admin.calls();
  }

  @Get("usage")
  usage() {
    return this.admin.usage();
  }

  @Get("faces/moderation")
  faces() {
    return this.admin.faceQueue();
  }

  @Post("faces/:id/decision")
  decideFace(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      status: "APPROVED" | "REJECTED" | "QUARANTINED";
      reasonCodes: string[];
      note?: string;
    },
  ) {
    return this.admin.decideFace(id, request.admin!.id, body);
  }

  @Get("abuse-reports")
  reports() {
    return this.admin.reports();
  }

  @Patch("abuse-reports/:id")
  updateReport(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: {
      status: "OPEN" | "INVESTIGATING" | "ACTIONED" | "DISMISSED";
      resolution?: string;
    },
  ) {
    return this.admin.updateReport(id, request.admin!.id, body);
  }

  @Post("credits/adjust")
  adjustCredits(
    @Req() request: AuthenticatedRequest,
    @Body() body: { userId: string; amountMilli: number; reason: string },
  ) {
    return this.admin.adjustCredits(request.admin!.id, body);
  }

  @Get("plans")
  plans() {
    return this.admin.plans();
  }

  @Put("plans/:id")
  updatePlan(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Parameters<AdminService["updatePlan"]>[2],
  ) {
    return this.admin.updatePlan(id, request.admin!.id, body);
  }

  @Get("settings")
  settings(@Query("namespace") namespace?: string) {
    return this.admin.settings(namespace);
  }

  @Put("settings/:namespace/:key")
  setSetting(
    @Param("namespace") namespace: string,
    @Param("key") key: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { value: object },
  ) {
    return this.admin.setPublicSetting(
      namespace,
      key,
      body.value,
      request.user.sub,
      request.admin!.id,
    );
  }

  @Post("notifications/broadcast")
  broadcast(
    @Req() request: AuthenticatedRequest,
    @Body() body: { title: string; body: string; audience?: string },
  ) {
    return this.admin.broadcast(request.admin!.id, body);
  }

  @Get("audit-logs")
  auditLogs() {
    return this.admin.auditLogs();
  }
}
