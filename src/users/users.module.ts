import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { ProfileBootstrapInterceptor } from './profile-bootstrap.interceptor';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, NewsletterModule],
  controllers: [UsersController],
  providers: [UsersService, ProfileBootstrapInterceptor],
  exports: [UsersService, ProfileBootstrapInterceptor],
})
export class UsersModule {}
