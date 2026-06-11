import { Module } from "@nestjs/common";
import { ProvidersModule } from "../providers/providers.module";
import { FacesController } from "./faces.controller";
import { FacesService } from "./faces.service";

@Module({
  imports: [ProvidersModule],
  controllers: [FacesController],
  providers: [FacesService],
  exports: [FacesService],
})
export class FacesModule {}
