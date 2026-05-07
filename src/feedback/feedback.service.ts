import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { messageFeedback, type MessageFeedback } from '../database/schema/messageFeedback';
import { messages } from '../database/schema/messages';
import { sessions } from '../database/schema/sessions';
import type { FeedbackInput } from './feedback.schemas';

@Injectable()
export class FeedbackService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async upsert(
    messageId: string,
    userId: string,
    body: FeedbackInput,
  ): Promise<MessageFeedback> {
    const [owned] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(sessions, eq(sessions.id, messages.sessionId))
      .where(and(eq(messages.id, messageId), eq(sessions.userId, userId)))
      .limit(1);

    if (!owned) {
      throw new ForbiddenException('Message not found or not owned');
    }

    const updateSet: Partial<MessageFeedback> = { updatedAt: new Date() };
    if (body.flagged !== undefined) updateSet.flagged = body.flagged;
    if (body.note !== undefined) updateSet.note = body.note;

    const [row] = await this.db
      .insert(messageFeedback)
      .values({
        messageId,
        userId,
        flagged: body.flagged ?? false,
        note: body.note ?? null,
      })
      .onConflictDoUpdate({
        target: [messageFeedback.messageId, messageFeedback.userId],
        set: updateSet,
      })
      .returning();

    return row;
  }
}
