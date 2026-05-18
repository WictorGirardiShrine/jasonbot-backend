import { date, integer, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

export const dailyMessageUsage = pgTable(
  'daily_message_usage',
  {
    userId: uuid('user_id').notNull(),
    usageDate: date('usage_date').notNull(),
    messageCount: integer('message_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.usageDate] })],
);

export type DailyMessageUsage = typeof dailyMessageUsage.$inferSelect;
export type NewDailyMessageUsage = typeof dailyMessageUsage.$inferInsert;
