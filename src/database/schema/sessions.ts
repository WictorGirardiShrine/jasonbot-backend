import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  title: text('title').notNull(),
  // Issue the user picked during issue-selection. Null until they choose.
  // Values: 'anxiety' | 'past_mistreatment'. ('debilitating_emotion' is reserved but hidden until Jason finishes that branch.)
  selectedIssue: text('selected_issue'),
  // Active coaching protocol for this session. Null until issue is picked and rotation resolved.
  // Values: 'submodality_shift' | 'tentacles' | 'neutralize_event' | 'letting_go'.
  activeProtocolKey: text('active_protocol_key'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
