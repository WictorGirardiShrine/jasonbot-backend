import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { messages, type Message } from '../database/schema/messages';
import { profiles } from '../database/schema/profiles';
import { sessions, type Session } from '../database/schema/sessions';

// TODO(jason): confirm or revise this opening — see docs/CHAT_NOTES.md
// Not in COACHING_PROTOCOL.md; carried over from the Lovable prototype as
// custom framing copy. The protocol itself opens at STEP 1 with three
// pacing statements; this greeting is shown before that flow begins.
const SEED_GREETING_TEMPLATE = `Hello, {name}, I'm the Jason Andrews Anxiety Elimination Bot.
I can guide you through some processes that Jason uses with clients.
Now, it won't be as perfect as Jason can do live, but I can usually help people.
You can send a message to Jason any time.
Are you ready to get started?`;

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

      const [profile] = await tx
        .select({ name: profiles.name })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      const seedContent = SEED_GREETING_TEMPLATE.replace(
        '{name}',
        profile?.name ?? 'friend',
      );

      const seedMessages = await tx
        .insert(messages)
        .values({
          sessionId: session.id,
          role: 'assistant',
          content: seedContent,
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
