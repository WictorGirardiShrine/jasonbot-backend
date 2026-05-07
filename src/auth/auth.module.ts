import { Module } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  providers: [JwtAuthGuard, AdminGuard],
  exports: [JwtAuthGuard, AdminGuard],
})
export class AuthModule {}
