import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../common/admin.guard";
import { AuthGuard } from "../common/auth.guard";
import type { AuthenticatedRequest } from "../common/request-user";
import { AdminPermission } from "../common/admin-permission";
import { ProvidersService } from "./providers.service";

@Controller("admin/providers")
@UseGuards(AuthGuard, AdminGuard)
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list() {
    return this.providers.list();
  }

  @Put(":provider")
  @AdminPermission("providers:write")
  async update(
    @Param("provider") provider: string,
    @Body() body: { values?: Record<string, unknown> },
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.providers.setProvider(
      provider,
      body.values ?? {},
      request.user.sub,
      request.admin!.id,
    );
    return {
      provider,
      configuredKeys: Object.keys(result),
    };
  }

  @Post(":provider/test")
  @AdminPermission("providers:write")
  test(@Param("provider") provider: string) {
    return this.providers.test(provider);
  }
}
