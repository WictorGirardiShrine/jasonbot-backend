import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe | null;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<boolean>('BILLING_STRIPE_ENABLED') === true;
    const secret = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    this.stripe =
      enabled && secret
        ? new Stripe(secret, {
            apiVersion: '2025-08-27.basil',
            typescript: true,
          })
        : null;
  }

  get client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Stripe billing is disabled');
    }
    return this.stripe;
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.client.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
    );
  }
}
