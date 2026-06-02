import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { newsletterSubscribers } from '../database/schema/newsletterSubscribers';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';
import { NewsletterPersistenceService } from './newsletter.persistence.service';
import { NewsletterService } from './newsletter.service';

const STALE_AFTER_HOURS = 1;
const KIT_REQUESTS_PER_RUN = 100;
const KIT_DELAY_BETWEEN_CALLS_MS = 600; // ~100 req/min, well under the 120/60s limit

@Injectable()
export class NewsletterReconcileService {
  private readonly logger = new Logger(NewsletterReconcileService.name);
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly newsletter: NewsletterService,
    private readonly persistence: NewsletterPersistenceService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async reconcile(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous reconcile run still in progress — skipping');
      return;
    }
    this.running = true;
    try {
      await this.backfillMissingRows();
      await this.refreshStaleRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'Reconcile run failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Cold-start protection: users whose Supabase metadata has `newsletter_consent_at`
   * but who never landed in `newsletter_subscribers` (e.g. because recordConsent
   * threw at signup time). Without this, those users are invisible to the
   * reconciler — see review item #3.
   */
  private async backfillMissingRows(): Promise<void> {
    const consenting = await this.listConsentingSupabaseUsers();
    if (consenting.length === 0) return;

    const present = await this.db
      .select({ userId: newsletterSubscribers.userId })
      .from(newsletterSubscribers);
    const presentIds = new Set(present.map((r) => r.userId));

    const missing = consenting.filter((u) => !presentIds.has(u.id));
    if (missing.length === 0) return;

    this.logger.log(
      { count: missing.length },
      'Backfilling missing newsletter_subscribers rows',
    );
    for (const u of missing) {
      await this.persistence.recordConsent({
        userId: u.id,
        email: u.email,
        consentAt: u.consentAt,
      });
    }
  }

  /**
   * For each row where state is unknown/inactive, or hasn't been synced in
   * STALE_AFTER_HOURS, fetch the current state from Kit and update the row.
   * Respects rate limits — see KIT_REQUESTS_PER_RUN / KIT_DELAY_BETWEEN_CALLS_MS.
   */
  private async refreshStaleRows(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);

    const stale = await this.db
      .select({
        userId: newsletterSubscribers.userId,
        email: newsletterSubscribers.email,
      })
      .from(newsletterSubscribers)
      .where(
        and(
          or(
            eq(newsletterSubscribers.kitState, 'unknown'),
            eq(newsletterSubscribers.kitState, 'inactive'),
            isNull(newsletterSubscribers.lastSyncedAt),
            lt(newsletterSubscribers.lastSyncedAt, cutoff),
          ),
          // Never bother re-checking terminal states.
          sql`${newsletterSubscribers.kitState} NOT IN ('cancelled', 'bounced', 'complained', 'deleted')`,
        ),
      )
      .limit(KIT_REQUESTS_PER_RUN);

    if (stale.length === 0) return;

    this.logger.log(
      { count: stale.length },
      'Reconciling subscriber state from Kit',
    );

    for (const row of stale) {
      const lookup = await this.newsletter.getSubscriberByEmail(row.email);
      await this.persistence.applyLookupResult({ userId: row.userId, lookup });
      await sleep(KIT_DELAY_BETWEEN_CALLS_MS);
    }
  }

  private async listConsentingSupabaseUsers(): Promise<
    Array<{ id: string; email: string; consentAt: Date }>
  > {
    const out: Array<{ id: string; email: string; consentAt: Date }> = [];
    let page = 1;
    const perPage = 500;
    // Cap pagination to avoid runaway loops on very large user bases.
    while (page <= 20) {
      const { data, error } = await this.supabase.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) {
        this.logger.warn({ err: error.message }, 'listUsers failed');
        break;
      }
      const batch = data.users ?? [];
      for (const u of batch) {
        const consentRaw = u.user_metadata?.newsletter_consent_at as
          | string
          | undefined;
        if (!consentRaw || !u.email) continue;
        out.push({
          id: u.id,
          email: u.email,
          consentAt: new Date(consentRaw),
        });
      }
      if (batch.length < perPage) break;
      page += 1;
    }
    return out;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
