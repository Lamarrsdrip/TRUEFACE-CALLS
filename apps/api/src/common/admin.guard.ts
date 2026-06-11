import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ADMIN_PERMISSION_KEY,
  hasAdminPermission,
  type AdminPermissionName,
} from "./admin-permission";
import type { AuthenticatedRequest } from "./request-user";
import { PrismaService } from "./prisma.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const admin = await this.prisma.adminUser.findUnique({
      where: { userId: request.user.sub },
      select: {
        id: true,
        role: true,
        permissions: true,
        active: true,
      },
    });

    if (!admin?.active) {
      throw new ForbiddenException("Administrator access required");
    }

    const required = this.reflector.getAllAndOverride<
      AdminPermissionName | undefined
    >(ADMIN_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (
      required &&
      !hasAdminPermission(admin.role, admin.permissions, required)
    ) {
      throw new ForbiddenException(
        `Administrator permission required: ${required}`,
      );
    }

    request.admin = {
      id: admin.id,
      role: admin.role,
      permissions: admin.permissions,
    };
    return true;
  }
}
