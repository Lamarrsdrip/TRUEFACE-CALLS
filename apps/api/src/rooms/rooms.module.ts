import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { CallsController, RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";

@Module({
  imports: [ProvidersModule],
  controllers: [RoomsController, CallsController],
  providers: [RoomsService],
})
export class RoomsModule {}
