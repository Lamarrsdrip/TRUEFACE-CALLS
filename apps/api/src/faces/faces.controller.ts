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
import { createHash } from "node:crypto";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { FacesService } from "./faces.service";

@Controller("faces")
@UseGuards(AuthGuard)
export class FacesController {
  constructor(private readonly faces: FacesService) {}

  @Post("upload-url")
  uploadUrl(
    @Req() request: AuthenticatedRequest,
    @Body() body: { contentType: string; sizeBytes: number },
  ) {
    return this.faces.createUploadUrl(request.user.sub, body);
  }

  @Post("quality-check")
  qualityCheck(
    @Body()
    body: Parameters<FacesService["qualityCheck"]>[0],
  ) {
    return this.faces.qualityCheck(body);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: Parameters<FacesService["create"]>[1],
  ) {
    const userAgent = request.headers["user-agent"]?.slice(0, 512);
    return this.faces.create(request.user.sub, body, {
      ipHash: createHash("sha256")
        .update(request.ip ?? "")
        .digest("hex"),
      ...(userAgent ? { userAgent } : {}),
    });
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.faces.list(request.user.sub);
  }

  @Post(":id/activate")
  activate(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.faces.activate(request.user.sub, id);
  }

  @Post(":id/revoke")
  revoke(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.faces.revoke(request.user.sub, id);
  }

  @Post(":id/status")
  setActive(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { active: boolean },
  ) {
    return this.faces.setActive(request.user.sub, id, body.active);
  }

  @Delete(":id")
  delete(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.faces.delete(request.user.sub, id);
  }
}
