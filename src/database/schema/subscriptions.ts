import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const subscriptionPlan = pgEnum('subscription_plan', [
  'free',
  'monthly',
  'annual',
]);

export const subscriptionStatus = pgEnum('subscription_status', [
  'none',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'incomplete',
]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  plan: subscriptionPlan('plan').notNull().default('free'),
  status: subscriptionStatus('status').notNull().default('none'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  betaAccessExpiresAt: timestamp('beta_access_expires_at', {
    withTimezone: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionPlan = (typeof subscriptionPlan.enumValues)[number];
export type SubscriptionStatus = (typeof subscriptionStatus.enumValues)[number];
