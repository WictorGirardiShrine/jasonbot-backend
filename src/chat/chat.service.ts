import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { ANTHROPIC } from '../anthropic/anthropic.module';
import { DB, type Database } from '../database/database.module';
import { messages } from '../database/schema/messages';
import { sessions } from '../database/schema/sessions';
import { MessagesService } from '../messages/messages.service';
import { RagService } from '../rag/rag.service';
import { SessionsService } from '../sessions/sessions.service';
import { ChatPromptService } from './chat.prompt.service';
import { nextProtocolKey, parseIssueFromMessage } from './chat.protocol-router';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 16000;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(ANTHROPIC) private readonly anthropic: Anthropic,
    @Inject(DB) private readonly db: Database,
    private readonly sessionsService: SessionsService,
    private readonly messagesService: MessagesService,
    private readonly promptService: ChatPromptService,
    private readonly ragService: RagService,
  ) {}

  async streamResponse(
    sessionId: string,
    userId: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    let session = await this.sessionsService.assertOwnership(sessionId, userId);

    const history = await this.messagesService.listBySession(sessionId, userId);
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      this.writeEvent(res, 'error', { code: 'NO_PENDING_TURN' });
      res.end();
      return;
    }

    const apiMessages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const lastUser = history[history.length - 1].content;

    // Issue-selection routing: if the user hasn't picked an issue yet and
    // their last message matches a known issue, resolve the active protocol
    // from the rotation and persist before building the prompt. This way
    // the very next turn injects the protocol asset, not the intro asset.
    if (!session.activeProtocolKey) {
      const issue = parseIssueFromMessage(lastUser);
      if (issue) {
        const protocolKey = await nextProtocolKey(this.db, userId, issue);
        const [updated] = await this.db
          .update(sessions)
          .set({
            selectedIssue: issue,
            activeProtocolKey: protocolKey,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId))
          .returning();
        session = updated;
        this.logger.log(
          `Router: session ${sessionId} → issue=${issue}, protocol=${protocolKey}`,
        );
      }
    }

    this.logger.log(
      `Turn: session=${sessionId} protocol=${session.activeProtocolKey ?? 'intro'}`,
    );

    const retrieved = await this.ragService.retrieve(lastUser, 4);
    if (retrieved.length > 0) {
      this.logger.log(
        `RAG: ${retrieved.length} excerpts (top score ${retrieved[0].score.toFixed(3)})`,
      );
    }

    const system = this.promptService.buildSystem(retrieved, session);

    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // SDK accepts an array of content blocks (with cache_control) for system.
      system: system,
      messages: apiMessages,
    });

    let aborted = false;
    const onClose = () => {
      aborted = true;
      try {
        stream.abort();
      } catch {
        // ignore — already closed
      }
    };
    req.on('close', onClose);

    let assistantText = '';
    try {
      for await (const event of stream) {
        if (aborted) break;
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          assistantText += event.delta.text;
          this.writeEvent(res, 'text_delta', { text: event.delta.text });
        }
      }

      if (aborted) {
        this.logger.log(`Stream aborted by client for session ${sessionId}`);
        return;
      }

      const final = await stream.finalMessage();
      this.logger.log(
        `Usage: input=${final.usage.input_tokens}, output=${final.usage.output_tokens}, cache_create=${final.usage.cache_creation_input_tokens ?? 0}, cache_read=${final.usage.cache_read_input_tokens ?? 0}`,
      );

      if (!assistantText.trim()) {
        throw new BadRequestException('Empty assistant response from Claude');
      }

      const persisted = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(messages)
          .values({ sessionId, role: 'assistant', content: assistantText })
          .returning();
        await tx
          .update(sessions)
          .set({ updatedAt: new Date() })
          .where(eq(sessions.id, sessionId));
        return created;
      });

      this.writeEvent(res, 'assistant_message', {
        id: persisted.id,
        createdAt: persisted.createdAt,
        content: persisted.content,
      });
      this.writeEvent(res, 'done', {});
    } catch (err) {
      if (aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Chat stream failed: ${msg}`);
      this.writeEvent(res, 'error', { message: msg });
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }

  private writeEvent(res: Response, event: string, data: unknown): void {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush — Express doesn't always flush small writes promptly behind compression middleware,
    // but Helmet/CORS/no-compression on this app means writes go out as-is.
  }
}
