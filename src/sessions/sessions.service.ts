import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { messages, type Message } from '../database/schema/messages';
import { sessions, type Session } from '../database/schema/sessions';

// Verbatim opening from INTRO_AND_ISSUE_SELECTION.md STEP 1.
// The full intro flow (disclaimer, pacing, issue selection) is delivered by
// the LLM under the INTRO protocol injected into the system prompt — the
// seed only needs to land the welcome and the understanding check.
const SEED_GREETING = `Hello and welcome to JasonBot. I can help with several common challenges that Jason helps clients with. I can't do as well as Jason can, but I can do a pretty good job of helping you in similar ways.

JasonBot is NOT designed to listen to you vent, or to help you cope, or to manage a crisis. JasonBot is designed to resolve a problem entirely through shifting the way you experience things on the inside. The aim is to eliminate the problem entirely, so this will be different from what you may have experienced before.

Do you understand what I mean by that?`;

@Injectable()
export class SessionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForUser(userId: string): Promise<Session[]> {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.updatedAt));
  }

  async create(
    userId: string,
  ): Promise<{ session: Session; messages: Message[] }> {
    return this.db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sessions)
        .where(eq(sessions.userId, userId));

      const [session] = await tx
        .insert(sessions)
        .values({ userId, title: `Session ${count + 1}` })
        .returning();

      const seedMessages = await tx
        .insert(messages)
        .values({
          sessionId: session.id,
          role: 'assistant',
          content: SEED_GREETING,
        })
        .returning();

      return { session, messages: seedMessages };
    });
  }

  async rename(id: string, userId: string, title: string): Promise<Session> {
    await this.assertOwnership(id, userId);
    const [updated] = await this.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, id))
      .returning();
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.assertOwnership(id, userId);
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async assertOwnership(sessionId: string, userId: string): Promise<Session> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .limit(1);
    if (!session) {
      // Don't leak existence — same response whether row missing or not owned.
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async touchUpdatedAt(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  // Used internally to keep ForbiddenException available for cross-module guards.
  static forbid(reason: string): never {
    throw new ForbiddenException(reason);
  }
}
