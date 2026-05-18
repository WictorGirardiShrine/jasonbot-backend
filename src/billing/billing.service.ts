import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import Stripe from 'stripe';
import { DB, type Database } from '../database/database.module';
import { profiles } from '../database/schema/profiles';
import {
  subscriptions,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '../database/schema/subscriptions';
import { stripeWebhookEvents } from '../database/schema/stripeWebhookEvents';
import { StripeService } from './stripe.service';
import { UsageService, type UsageSnapshot } from './usage.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stripe: StripeService,
    private readonly usage: UsageService,
    private readonly config: ConfigService,
  ) {}

  private get monthlyPriceId(): string {
    return this.config.getOrThrow<string>('STRIPE_PRICE_MONTHLY_ID');
  }

  private get annualPriceId(): string {
    return this.config.getOrThrow<string>('STRIPE_PRICE_ANNUAL_ID');
  }

  private get successUrl(): string {
    const frontend = this.config.getOrThrow<string>('FRONTEND_URL');
    return `${frontend}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
  }

  private get cancelUrl(): string {
    const frontend = this.config.getOrThrow<string>('FRONTEND_URL');
    return `${frontend}/pricing`;
  }

  private get portalReturnUrl(): string {
    const frontend = this.config.getOrThrow<string>('FRONTEND_URL');
    return `${frontend}/profile`;
  }

  async getSnapshot(userId: string): Promise<
    UsageSnapshot & {
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    }
  > {
    const sub = await this.usage.getSubscription(userId);
    const usage = await this.usage.snapshot(userId);
    return {
      ...usage,
      currentPeriodEnd: sub?.currentPeriodEnd
        ? sub.currentPeriodEnd.toISOString()
        : null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }

  async getOrCreateStripeCustomer(
    userId: string,
    email: string,
  ): Promise<string> {
    const existing = await this.usage.getSubscription(userId);
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    const customer = await this.stripe.client.customers.create({
      email,
      metadata: { jasonbotUserId: userId },
    });

    await this.db
      .insert(subscriptions)
      .values({ userId, stripeCustomerId: customer.id })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { stripeCustomerId: customer.id, updatedAt: new Date() },
      });

    return customer.id;
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    plan: 'monthly' | 'annual',
  ): Promise<{ url: string }> {
    const customerId = await this.getOrCreateStripeCustomer(userId, email);
    const priceId =
      plan === 'monthly' ? this.monthlyPriceId : this.annualPriceId;

    const session = await this.stripe.client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      customer_update: { address: 'auto', name: 'auto' },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      client_reference_id: userId,
      metadata: { jasonbotUserId: userId, plan },
      subscription_data: {
        metadata: { jasonbotUserId: userId, plan },
      },
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }
    return { url: session.url };
  }

  async createPortalSession(
    userId: string,
    email: string,
  ): Promise<{ url: string }> {
    const customerId = await this.getOrCreateStripeCustomer(userId, email);
    const portal = await this.stripe.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: this.portalReturnUrl,
    });
    return { url: portal.url };
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    // Idempotency — short-circuit if we've already processed this event.
    const [existing] = await this.db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, event.id))
      .limit(1);
    if (existing) {
      this.logger.log(
        `Skipping duplicate webhook event ${event.id} (${event.type})`,
      );
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.onCheckoutCompleted(event.data.object);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.onSubscriptionChanged(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.onSubscriptionDeleted(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.onPaymentFailed(event.data.object);
          break;
        case 'invoice.payment_succeeded':
          await this.onPaymentSucceeded(event.data.object);
          break;
        default:
          this.logger.debug(`Ignoring unhandled event type: ${event.type}`);
      }

      await this.db
        .insert(stripeWebhookEvents)
        .values({ eventId: event.id, type: event.type })
        .onConflictDoNothing();
    } catch (err) {
      // Don't insert the idempotency row on failure — Stripe will retry.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Webhook handler failed for ${event.id} (${event.type}): ${msg}`,
      );
      throw err;
    }
  }

  private async onCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId =
      session.client_reference_id ?? session.metadata?.jasonbotUserId ?? null;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!userId || !customerId) {
      this.logger.warn(
        `checkout.session.completed missing userId/customer (session ${session.id})`,
      );
      return;
    }

    if (!subscriptionId) {
      // Non-subscription checkout — ignore.
      return;
    }

    const sub = await this.stripe.client.subscriptions.retrieve(subscriptionId);
    await this.upsertSubscriptionFromStripe(userId, customerId, sub);
  }

  private async onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
    const userId = await this.resolveUserId(sub);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (!userId) {
      this.logger.warn(
        `subscription.* event without jasonbotUserId metadata (sub ${sub.id})`,
      );
      return;
    }
    await this.upsertSubscriptionFromStripe(userId, customerId, sub);
  }

  private async onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const userId = await this.resolveUserId(sub);
    if (!userId) {
      this.logger.warn(
        `subscription.deleted without jasonbotUserId metadata (sub ${sub.id})`,
      );
      return;
    }
    await this.db
      .update(subscriptions)
      .set({
        plan: 'free',
        status: 'canceled',
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = this.extractSubscriptionIdFromInvoice(invoice);
    if (!subscriptionId) return;
    const sub = await this.stripe.client.subscriptions.retrieve(subscriptionId);
    const userId = await this.resolveUserId(sub);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (!userId) return;
    await this.upsertSubscriptionFromStripe(userId, customerId, sub);
  }

  private async onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = this.extractSubscriptionIdFromInvoice(invoice);
    if (!subscriptionId) return;
    const sub = await this.stripe.client.subscriptions.retrieve(subscriptionId);
    const userId = await this.resolveUserId(sub);
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    if (!userId) return;
    await this.upsertSubscriptionFromStripe(userId, customerId, sub);
  }

  private extractSubscriptionIdFromInvoice(
    invoice: Stripe.Invoice,
  ): string | null {
    const inv = invoice as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
    };
    if (!inv.subscription) return null;
    return typeof inv.subscription === 'string'
      ? inv.subscription
      : inv.subscription.id;
  }

  private async resolveUserId(
    sub: Stripe.Subscription,
  ): Promise<string | null> {
    if (sub.metadata?.jasonbotUserId) return sub.metadata.jasonbotUserId;
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const [row] = await this.db
      .select({ userId: subscriptions.userId })
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);
    return row?.userId ?? null;
  }

  private async upsertSubscriptionFromStripe(
    userId: string,
    customerId: string,
    sub: Stripe.Subscription,
  ): Promise<void> {
    const plan = this.planFromSubscription(sub);
    const status = this.mapStatus(sub.status);
    const currentPeriodEnd = this.extractCurrentPeriodEnd(sub);
    const cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;

    await this.db
      .insert(subscriptions)
      .values({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        plan,
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          plan,
          status,
          currentPeriodEnd,
          cancelAtPeriodEnd,
          updatedAt: new Date(),
        },
      });
  }

  private planFromSubscription(sub: Stripe.Subscription): SubscriptionPlan {
    const priceId = sub.items.data[0]?.price?.id;
    if (priceId === this.monthlyPriceId) return 'monthly';
    if (priceId === this.annualPriceId) return 'annual';
    // Unknown price — fall back to free so we never grant access by accident.
    this.logger.warn(
      `Unrecognized priceId on subscription ${sub.id}: ${priceId}`,
    );
    return 'free';
  }

  private mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
    switch (s) {
      case 'active':
      case 'trialing':
      case 'past_due':
      case 'canceled':
      case 'incomplete':
        return s;
      case 'incomplete_expired':
        return 'canceled';
      case 'unpaid':
        return 'past_due';
      case 'paused':
        return 'canceled';
      default:
        return 'none';
    }
  }

  private extractCurrentPeriodEnd(sub: Stripe.Subscription): Date | null {
    const periodEnd = (
      sub as Stripe.Subscription & { current_period_end?: number | null }
    ).current_period_end;
    if (typeof periodEnd === 'number') return new Date(periodEnd * 1000);
    const itemEnd = sub.items.data[0] as
      | (Stripe.SubscriptionItem & { current_period_end?: number })
      | undefined;
    if (itemEnd?.current_period_end)
      return new Date(itemEnd.current_period_end * 1000);
    return null;
  }

  async assertProfileExists(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!row) throw new NotFoundException('Profile not found');
  }
}
