import { Module } from '@nestjs/common';
import { OfferDraftsController } from './offer-drafts.controller';
import { OfferDraftsService } from './offer-drafts.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [OfferDraftsController],
  providers: [OfferDraftsService],
})
export class OfferDraftsModule {}
