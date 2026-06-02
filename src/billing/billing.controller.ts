import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BillingService } from './billing.service';
import {
  checkoutSessionSchema,
  type CheckoutSessionInput,
} from './billing.schemas';
import { StripeService } from './stripe.service';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  private assertStripeEnabled(): void {
    if (this.config.get<boolean>('BILLING_STRIPE_ENABLED') !== true) {
      throw new GoneException('Stripe billing is disabled');
    }
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  subscription(@CurrentUser() user: AuthUser) {
    return this.billing.getSnapshot(user.id);
  }

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  async checkout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(checkoutSessionSchema))
    body: CheckoutSessionInput,
  ) {
    this.assertStripeEnabled();
    return this.billing.createCheckoutSession(user.id, user.email, body.plan);
  }

  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  async portal(@CurrentUser() user: AuthUser) {
    this.assertStripeEnabled();
    return this.billing.createPortalSession(user.id, user.email);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    this.assertStripeEnabled();
    if (!signature)
      throw new BadRequestException('Missing stripe-signature header');
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) throw new BadRequestException('Missing raw body for webhook');

    let event: Stripe.Event;
    try {
      event = this.stripe.constructEvent(raw, signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook signature verification failed: ${msg}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    await this.billing.handleWebhookEvent(event);
    return { received: true };
  }
}
