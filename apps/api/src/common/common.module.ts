import { Global, Module } from "@nestjs/common";
import { AdminGuard } from "./admin.guard";
import { AuthGuard } from "./auth.guard";

@Global()
@Module({
  providers: [AuthGuard, AdminGuard],
  exports: [AuthGuard, AdminGuard],
})
export class CommonModule {}
