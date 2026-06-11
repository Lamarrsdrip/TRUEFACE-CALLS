import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.rooms.create(request.user.sub, body);
  }

  @Get(":slug")
  resolve(@Param("slug") slug: string, @Query("invite") inviteToken: string) {
    return this.rooms.resolve(slug, inviteToken);
  }

  @Post(":id/join-request")
  requestGuestJoin(
    @Param("id") roomId: string,
    @Body()
    body: { inviteToken: string; guestName: string; password?: string },
  ) {
    return this.rooms.requestGuestJoin(roomId, body);
  }

  @Post(":id/join-user")
  @UseGuards(AuthGuard)
  requestUserJoin(
    @Param("id") roomId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: { inviteToken: string; password?: string },
  ) {
    return this.rooms.requestUserJoin(roomId, request.user.sub, body);
  }

  @Get(":id/waiting")
  @UseGuards(AuthGuard)
  waiting(@Param("id") roomId: string, @Req() request: AuthenticatedRequest) {
    return this.rooms.waitingRoom(roomId, request.user.sub);
  }

  @Post(":id/approve/:participantId")
  @UseGuards(AuthGuard)
  approve(
    @Param("id") roomId: string,
    @Param("participantId") participantId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rooms.decideParticipant(
      roomId,
      request.user.sub,
      participantId,
      true,
    );
  }

  @Post(":id/reject/:participantId")
  @UseGuards(AuthGuard)
  reject(
    @Param("id") roomId: string,
    @Param("participantId") participantId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rooms.decideParticipant(
      roomId,
      request.user.sub,
      participantId,
      false,
    );
  }

  @Post(":id/token")
  @UseGuards(AuthGuard)
  token(@Param("id") roomId: string, @Req() request: AuthenticatedRequest) {
    return this.rooms.userToken(roomId, request.user.sub);
  }

  @Post(":id/guest-token")
  guestToken(
    @Param("id") roomId: string,
    @Body() body: { participantId: string; guestToken: string },
  ) {
    return this.rooms.guestToken(roomId, body);
  }

  @Post(":id/end")
  @UseGuards(AuthGuard)
  end(@Param("id") roomId: string, @Req() request: AuthenticatedRequest) {
    return this.rooms.end(roomId, request.user.sub);
  }
}

@Controller("calls")
@UseGuards(AuthGuard)
export class CallsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get("history")
  history(@Req() request: AuthenticatedRequest) {
    return this.rooms.history(request.user.sub);
  }
}
