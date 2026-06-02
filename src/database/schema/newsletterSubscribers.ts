import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const kitSubscriberState = pgEnum('kit_subscriber_state', [
  'unknown',
  'active',
  'inactive',
  'bounced',
  'complained',
  'cancelled',
  'deleted',
]);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique(),
  email: text('email').notNull(),
  kitSubscriberId: bigint('kit_subscriber_id', { mode: 'number' }),
  kitState: kitSubscriberState('kit_state').notNull().default('unknown'),
  kitFormId: text('kit_form_id'),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  firstSyncedAt: timestamp('first_synced_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert;
export type KitSubscriberStateValue =
  (typeof kitSubscriberState.enumValues)[number];
