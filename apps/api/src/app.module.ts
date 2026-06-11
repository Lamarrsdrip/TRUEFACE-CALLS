import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret:
        process.env.AUTH_SECRET ??
        "development-auth-secret-that-is-at-least-32-characters",
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
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfMiddleware)
      .forRoutes({ path: "*path", method: RequestMethod.ALL });
  }
}
