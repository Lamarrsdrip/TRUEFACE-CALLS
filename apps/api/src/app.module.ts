import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { CommonModule } from "./common/common.module";
import { CsrfMiddleware } from "./common/csrf.middleware";
import { PrismaModule } from "./common/prisma.module";
import { CreditsModule } from "./credits/credits.module";
import { FacesModule } from "./faces/faces.module";
import { HealthModule } from "./health/health.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ProvidersModule } from "./providers/providers.module";
import { RoomsModule } from "./rooms/rooms.module";
import { SafetyModule } from "./safety/safety.module";
import { authSecret } from "./common/runtime-config";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: authSecret(),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule,
    HealthModule,
    ProvidersModule,
    CreditsModule,
    RoomsModule,
    FacesModule,
    BillingModule,
    SafetyModule,
    NotificationsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
