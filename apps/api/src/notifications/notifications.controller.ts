import { Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.user.sub);
  }

  @Patch(":id/read")
  markRead(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.notifications.markRead(request.user.sub, id);
  }
}
