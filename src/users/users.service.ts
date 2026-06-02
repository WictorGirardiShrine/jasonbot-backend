import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module';
import { NewsletterPersistenceService } from '../newsletter/newsletter.persistence.service';
import { NewsletterService } from '../newsletter/newsletter.service';
import { profiles, type Profile } from '../database/schema/profiles';
import { subscriptions } from '../database/schema/subscriptions';
import { SUPABASE_ADMIN } from '../supabase/supabase.module';

export type ProfileWithRole = Profile & {
  email: string;
  role: 'admin' | 'user';
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly newsletter: NewsletterService,
    private readonly newsletterPersistence: NewsletterPersistenceService,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getOrCreateProfile(
    userId: string,
    email: string,
  ): Promise<ProfileWithRole> {
    // The Supabase `on_auth_user_created` trigger pre-creates the `profiles`
    // row at signup, so we cannot use that insert as the "first sight" signal.
    // Instead, gate the bootstrap on the `subscriptions` insert — that table
    // is owned by this service alone, so a successful INSERT here means we're
    // seeing this user for the first time. Race-safe via ON CONFLICT DO
    // NOTHING: the winning INSERT returns a row, losers return [].
    const betaDays = this.config.get<number>('BETA_ACCESS_DURATION_DAYS') ?? 30;
    const betaAccessExpiresAt = new Date(Date.now() + betaDays * 86_400_000);

    const [subCreated] = await this.db
      .insert(subscriptions)
      .values({ userId, betaAccessExpiresAt })
      .onConflictDoNothing()
      .returning();

    // Defensive: ensure the profile exists too. The trigger handles this in
    // production, but the idempotent INSERT also covers dev/test envs that
    // skip the trigger.
    const fallbackName = email.split('@')[0] ?? 'friend';
    await this.db
      .insert(profiles)
      .values({ id: userId, name: fallbackName })
      .onConflictDoNothing();

    if (subCreated) {
      this.logger.log(
        { userId, email, betaAccessExpiresAt },
        'Bootstrapping new subscription + newsletter',
      );
      // Fire-and-forget so the bootstrap request returns immediately.
      // The reconciler will pick it up if it never lands.
      void this.maybeSubscribeToNewsletter(userId, email).catch(
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            { userId, err: message },
            'maybeSubscribeToNewsletter crashed',
          );
        },
      );
    }

    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    return {
      ...profile,
      email,
      role: this.isAdmin(email) ? 'admin' : 'user',
    };
  }

  async acceptDisclaimer(userId: string): Promise<void> {
    await this.db
      .update(profiles)
      .set({ disclaimerAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(profiles.id, userId));
  }

  async updateName(
    userId: string,
    email: string,
    name: string,
  ): Promise<ProfileWithRole> {
    const [updated] = await this.db
      .update(profiles)
      .set({ name, updatedAt: new Date() })
      .where(eq(profiles.id, userId))
      .returning();

    return {
      ...updated,
      email,
      role: this.isAdmin(email) ? 'admin' : 'user',
    };
  }

  private async maybeSubscribeToNewsletter(
    userId: string,
    email: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.auth.admin.getUserById(userId);
    if (error) {
      this.logger.warn(
        { userId, err: error.message },
        'Failed to read Supabase user metadata for newsletter consent',
      );
      return;
    }
    const metadata = data.user?.user_metadata;
    const consentRaw =
      typeof metadata?.newsletter_consent_at === 'string'
        ? metadata.newsletter_consent_at
        : null;
    if (!consentRaw) return;

    const consentAt = new Date(consentRaw);
    const firstName = typeof metadata?.name === 'string' ? metadata.name : null;

    // Lock in the consent row immediately so the reconciler can find this user
    // even if the Kit network call below never completes.
    await this.newsletterPersistence
      .recordConsent({ userId, email, consentAt })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { userId, err: message },
          'recordConsent failed — reconciler will retry',
        );
      });

    this.logger.log({ userId, email }, 'Calling Kit subscribeToForm');
    // Fire-and-forget the Kit POST. Persistence of its result is awaited inside
    // a separate promise chain so a slow Kit response doesn't block signup.
    void this.newsletter
      .subscribeToForm(email, firstName)
      .then(async (result) => {
        await this.newsletterPersistence.recordSubscribeResult({
          userId,
          email,
          consentAt,
          result,
        });
        if (result.ok) {
          this.logger.log(
            {
              userId,
              email,
              subscriberId: result.subscriberId,
              state: result.state,
              tagged: result.tagged,
              alreadyOnForm: result.alreadyOnForm,
            },
            'Kit subscribe ok',
          );
        } else {
          this.logger.warn(
            { userId, email, error: result.error },
            'Kit subscribe failed',
          );
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { userId, err: message },
          'subscribeToForm pipeline crashed',
        );
      });
  }

  private isAdmin(email: string): boolean {
    const allowlist = this.config.getOrThrow<string[]>('ADMIN_EMAILS');
    return allowlist.includes(email.toLowerCase());
  }
}
