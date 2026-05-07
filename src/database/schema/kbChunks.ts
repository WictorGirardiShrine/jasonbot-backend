import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { vector } from './vector';

export const kbChunks = pgTable('kb_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type KbChunk = typeof kbChunks.$inferSelect;
export type NewKbChunk = typeof kbChunks.$inferInsert;
