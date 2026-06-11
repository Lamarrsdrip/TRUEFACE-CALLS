import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";

@Module({
  imports: [ProvidersModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
