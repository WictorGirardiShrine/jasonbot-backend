import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { EmbeddingService } from './embedding.service';

export type RetrievedChunk = {
  id: string;
  source: string;
  title: string | null;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};

const SCORE_FLOOR = 0.55;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly embedding: EmbeddingService,
  ) {}

  async retrieve(query: string, k = 4): Promise<RetrievedChunk[]> {
    if (!query.trim()) return [];

    const vec = await this.embedding.embedQuery(query);
    const literal = `[${vec.join(',')}]`;

    const rows = await this.db.execute<{
      id: string;
      source: string;
      title: string | null;
      content: string;
      metadata: Record<string, unknown>;
      score: number;
    }>(sql`
      SELECT c.id, d.source, d.title, c.content, c.metadata,
             1 - (c.embedding <=> ${literal}::vector) AS score
        FROM kb_chunks c
        JOIN kb_documents d ON d.id = c.document_id
       ORDER BY c.embedding <=> ${literal}::vector ASC
       LIMIT ${k}
    `);

    return rows
      .filter((r) => r.score >= SCORE_FLOOR)
      .map((r) => ({
        id: r.id,
        source: r.source,
        title: r.title,
        content: r.content,
        score: Number(r.score),
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      }));
  }
}
