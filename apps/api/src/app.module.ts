import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { ProductsModule } from './products/products.module';
import { RadarModule } from './radar/radar.module';
import { OfferDraftsModule } from './offer-drafts/offer-drafts.module';
import { FinanceModule } from './finance/finance.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
    HealthModule,
    ProductsModule,
    RadarModule,
    OfferDraftsModule,
    FinanceModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
