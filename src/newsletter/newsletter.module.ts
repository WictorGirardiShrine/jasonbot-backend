import { Module } from '@nestjs/common';
import { NewsletterPersistenceService } from './newsletter.persistence.service';
import { NewsletterReconcileService } from './newsletter.reconcile.service';
import { NewsletterService } from './newsletter.service';

@Module({
  providers: [
    NewsletterService,
    NewsletterPersistenceService,
    NewsletterReconcileService,
  ],
  exports: [NewsletterService, NewsletterPersistenceService],
})
export class NewsletterModule {}
