import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [ProvidersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
