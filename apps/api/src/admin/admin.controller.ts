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
import { AdminPermission } from "../common/admin-permission";
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
  users(@Query("search") search?: string) {
    return this.admin.users(search);
  }

  @Get("users/:id")
  user(@Param("id") id: string) {
    return this.admin.user(id);
  }

  @Patch("users/:id/status")
  @AdminPermission("users:write")
  updateUser(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: { status: "ACTIVE" | "SUSPENDED" | "DELETION_PENDING" },
  ) {
    return this.admin.updateUserStatus(id, request.admin!.id, body.status);
  }

  @Patch("users/:id/room-access")
  @AdminPermission("users:write")
  updateRoomAccess(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { disabled: boolean },
  ) {
    return this.admin.updateRoomAccess(id, request.admin!.id, body.disabled);
  }

  @Get("subscriptions")
  subscriptions() {
    return this.admin.subscriptions();
  }

  @Get("payments")
  payments(
    @Query("provider") provider?: string,
    @Query("status") status?: string,
  ) {
    return this.admin.payments({
      ...(provider ? { provider } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Post("payments/:id/decision")
  @AdminPermission("billing:write")
  decidePayment(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { decision: "APPROVE" | "REJECT"; reason?: string },
  ) {
    return this.admin.decideManualPayment(id, request.admin!.id, body);
  }

  @Get("payments/:id/proof")
  paymentProof(@Param("id") id: string) {
    return this.admin.manualPaymentProof(id);
  }

  @Get("calls")
  calls() {
    return this.admin.calls();
  }

  @Post("calls/:id/end")
  @AdminPermission("calls:write")
  endCall(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { reason?: string },
  ) {
    return this.admin.endCall(id, request.admin!.id, body.reason);
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
  @AdminPermission("faces:write")
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

  @Post("faces/:id/delete")
  @AdminPermission("faces:write")
  deleteFace(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { reason?: string },
  ) {
    return this.admin.deleteFace(id, request.admin!.id, body.reason);
  }

  @Get("abuse-reports")
  reports() {
    return this.admin.reports();
  }

  @Patch("abuse-reports/:id")
  @AdminPermission("reports:write")
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
  @AdminPermission("credits:write")
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
  @AdminPermission("plans:write")
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

  @Get("deployment")
  @AdminPermission("settings:read")
  deployment() {
    return this.admin.deploymentStatus();
  }

  @Put("settings/:namespace/:key")
  @AdminPermission("settings:write")
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
  @AdminPermission("settings:write")
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

  @Get("audit-logs/export")
  auditExport() {
    return this.admin.auditExport();
  }
}
