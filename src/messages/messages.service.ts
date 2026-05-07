import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { messageFeedback, type MessageFeedback } from '../database/schema/messageFeedback';
import { messages, type Message } from '../database/schema/messages';
import { sessions } from '../database/schema/sessions';
import { SessionsService } from '../sessions/sessions.service';

export type MessageWithFeedback = Message & {
  feedback: Pick<MessageFeedback, 'flagged' | 'note'> | null;
};

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessionsService: SessionsService,
  ) {}

  async listBySession(
    sessionId: string,
    userId: string,
  ): Promise<MessageWithFeedback[]> {
    await this.sessionsService.assertOwnership(sessionId, userId);

    const rows = await this.db
      .select({
        message: messages,
        feedback: messageFeedback,
      })
      .from(messages)
      .leftJoin(
        messageFeedback,
        and(
          eq(messageFeedback.messageId, messages.id),
          eq(messageFeedback.userId, userId),
        ),
      )
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt));

    return rows.map((row) => ({
      ...row.message,
      feedback: row.feedback
        ? { flagged: row.feedback.flagged, note: row.feedback.note }
        : null,
    }));
  }

  async createUserMessage(
    sessionId: string,
    userId: string,
    content: string,
  ): Promise<Message> {
    await this.sessionsService.assertOwnership(sessionId, userId);

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({ sessionId, role: 'user', content })
        .returning();

      await tx
        .update(sessions)
        .set({ updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));

      // Assistant streaming response is fired separately via POST /sessions/:sessionId/respond
      // (ChatModule). User-message persistence stays atomic here.
      return created;
    });
  }
}
