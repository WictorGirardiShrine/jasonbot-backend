import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { UsageService } from './usage.service';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [StripeService, UsageService, BillingService],
  exports: [UsageService, BillingService],
})
export class BillingModule {}
