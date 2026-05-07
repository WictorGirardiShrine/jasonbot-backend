import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { sendMessageSchema, type SendMessageInput } from './messages.schemas';
import { MessagesService } from './messages.service';

@Controller('sessions/:sessionId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.listBySession(sessionId, user.id);
  }

  @Post()
  create(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messages.createUserMessage(sessionId, user.id, body.content);
  }
}
