import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { dailyMessageUsage } from '../database/schema/dailyMessageUsage';
import {
  subscriptions,
  type Subscription,
} from '../database/schema/subscriptions';

export const FREE_LIMIT_EXCEEDED_CODE = 'FREE_LIMIT_EXCEEDED';

export type UsageSnapshot = {
  plan: Subscription['plan'];
  status: Subscription['status'];
  isPaid: boolean;
  dailyLimit: number;
  usageToday: number;
  remainingToday: number;
  betaAccessExpiresAt: string | null;
};

@Injectable()
export class UsageService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  private get dailyLimit(): number {
    return this.config.getOrThrow<number>('FREE_TIER_DAILY_MESSAGE_LIMIT');
  }

  private hasUnlimitedAccess(
    sub: Pick<Subscription, 'plan' | 'status' | 'betaAccessExpiresAt'> | null,
  ): boolean {
    // Free + newsletter model: any authenticated user with a subscription row
    // gets unlimited access. The daily counter is still recorded for analytics
    // but never blocks. The `plan`/`status` branch is retained so dormant Stripe
    // logic stays meaningful if BILLING_STRIPE_ENABLED is ever flipped back on.
    if (!sub) return false;
    return true;
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async snapshot(userId: string): Promise<UsageSnapshot> {
    const sub = await this.getSubscription(userId);
    const usageToday = await this.countToday(userId);
    const isPaid = this.hasUnlimitedAccess(sub);
    const dailyLimit = this.dailyLimit;
    return {
      plan: sub?.plan ?? 'free',
      status: sub?.status ?? 'none',
      isPaid,
      dailyLimit,
      usageToday,
      remainingToday: isPaid
        ? Number.POSITIVE_INFINITY
        : Math.max(0, dailyLimit - usageToday),
      betaAccessExpiresAt: sub?.betaAccessExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Atomically records one message and enforces the free-tier daily cap.
   * For paid users: increment and return; the counter is informational.
   * For free users: if increment would exceed the limit, throw 402 FREE_LIMIT_EXCEEDED.
   */
  async recordAndCheckMessage(
    userId: string,
  ): Promise<{ usageToday: number; dailyLimit: number; isPaid: boolean }> {
    const sub = await this.getSubscription(userId);
    const isPaid = this.hasUnlimitedAccess(sub);
    const limit = this.dailyLimit;

    // Atomic UPSERT — returns the new count after increment.
    const [row] = await this.db
      .insert(dailyMessageUsage)
      .values({
        userId,
        usageDate: sql`(now() at time zone 'utc')::date`,
        messageCount: 1,
      })
      .onConflictDoUpdate({
        target: [dailyMessageUsage.userId, dailyMessageUsage.usageDate],
        set: { messageCount: sql`${dailyMessageUsage.messageCount} + 1` },
      })
      .returning({ count: dailyMessageUsage.messageCount });

    const usageToday = row?.count ?? 1;

    if (!isPaid && usageToday > limit) {
      // Roll back the increment so we don't drift over the cap on retries.
      await this.db
        .update(dailyMessageUsage)
        .set({ messageCount: sql`${dailyMessageUsage.messageCount} - 1` })
        .where(
          and(
            eq(dailyMessageUsage.userId, userId),
            eq(
              dailyMessageUsage.usageDate,
              sql`(now() at time zone 'utc')::date`,
            ),
          ),
        );

      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: FREE_LIMIT_EXCEEDED_CODE,
          message: 'Daily free-tier message limit reached.',
          limit,
          used: limit,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return { usageToday, dailyLimit: limit, isPaid };
  }

  private async countToday(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: dailyMessageUsage.messageCount })
      .from(dailyMessageUsage)
      .where(
        and(
          eq(dailyMessageUsage.userId, userId),
          eq(
            dailyMessageUsage.usageDate,
            sql`(now() at time zone 'utc')::date`,
          ),
        ),
      )
      .limit(1);
    return row?.count ?? 0;
  }
}
