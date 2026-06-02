import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import {
  newsletterSubscribers,
  type KitSubscriberStateValue,
} from '../database/schema/newsletterSubscribers';
import type { LookupResult, SubscribeResult } from './newsletter.service';

@Injectable()
export class NewsletterPersistenceService {
  private readonly logger = new Logger(NewsletterPersistenceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  // Returns the configured Kit target ID (currently a tag ID). Stored on the
  // newsletter_subscribers.kit_form_id column for historical reasons — the
  // column name predates the switch from form-subscribe to tag-subscribe.
  private get formId(): string | null {
    return this.config.get<string>('CONVERTKIT_TAG_ID') ?? null;
  }

  async recordConsent(input: {
    userId: string;
    email: string;
    consentAt: Date;
  }): Promise<void> {
    await this.db
      .insert(newsletterSubscribers)
      .values({
        userId: input.userId,
        email: input.email,
        consentAt: input.consentAt,
        kitState: 'unknown',
        kitFormId: this.formId,
      })
      .onConflictDoNothing();
  }

  async recordSubscribeResult(input: {
    userId: string;
    email: string;
    consentAt: Date;
    result: SubscribeResult;
  }): Promise<void> {
    const now = new Date();
    const base = {
      userId: input.userId,
      email: input.email,
      consentAt: input.consentAt,
      kitFormId: this.formId,
      firstSyncedAt: now,
      lastSyncedAt: now,
      updatedAt: now,
    };

    if (input.result.ok) {
      const state: KitSubscriberStateValue = input.result.state;
      await this.db
        .insert(newsletterSubscribers)
        .values({
          ...base,
          kitSubscriberId: input.result.subscriberId,
          kitState: state,
          lastError: null,
        })
        .onConflictDoUpdate({
          target: newsletterSubscribers.userId,
          set: {
            kitSubscriberId: input.result.subscriberId,
            kitState: state,
            kitFormId: this.formId,
            firstSyncedAt: now,
            lastSyncedAt: now,
            lastError: null,
            updatedAt: now,
          },
        });
      return;
    }

    await this.db
      .insert(newsletterSubscribers)
      .values({
        ...base,
        kitState: 'unknown',
        lastError: input.result.error,
        firstSyncedAt: null,
      })
      .onConflictDoUpdate({
        target: newsletterSubscribers.userId,
        set: {
          kitFormId: this.formId,
          lastError: input.result.error,
          updatedAt: now,
        },
      });
  }

  async applyLookupResult(input: {
    userId: string;
    lookup: LookupResult;
  }): Promise<void> {
    const now = new Date();

    if (!input.lookup.ok) {
      await this.db
        .update(newsletterSubscribers)
        .set({
          lastSyncedAt: now,
          lastError: input.lookup.error,
          updatedAt: now,
        })
        .where(eq(newsletterSubscribers.userId, input.userId));
      return;
    }

    if (!input.lookup.found) {
      // Subscriber exists locally but not in Kit — likely manually deleted.
      await this.db
        .update(newsletterSubscribers)
        .set({
          kitState: 'deleted',
          lastSyncedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(newsletterSubscribers.userId, input.userId));
      return;
    }

    await this.db
      .update(newsletterSubscribers)
      .set({
        kitSubscriberId: input.lookup.subscriberId,
        kitState: input.lookup.state,
        firstSyncedAt: sql`COALESCE(${newsletterSubscribers.firstSyncedAt}, ${now})`,
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(newsletterSubscribers.userId, input.userId));
  }
}
