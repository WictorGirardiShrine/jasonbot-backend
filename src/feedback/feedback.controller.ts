import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { feedbackSchema, type FeedbackInput } from './feedback.schemas';
import { FeedbackService } from './feedback.service';

@Controller('messages/:messageId/feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Put()
  upsert(
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(feedbackSchema)) body: FeedbackInput,
  ) {
    return this.feedback.upsert(messageId, user.id, body);
  }
}
