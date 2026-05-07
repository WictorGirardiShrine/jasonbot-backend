import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, SessionsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
