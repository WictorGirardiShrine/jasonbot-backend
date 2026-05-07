import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { RagModule } from '../rag/rag.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ChatController } from './chat.controller';
import { ChatPromptService } from './chat.prompt.service';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, SessionsModule, MessagesModule, RagModule],
  controllers: [ChatController],
  providers: [ChatService, ChatPromptService],
})
export class ChatModule {}
