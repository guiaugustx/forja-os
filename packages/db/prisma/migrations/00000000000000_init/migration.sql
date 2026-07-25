-- CreateEnum
CREATE TYPE "CampaignPlatform" AS ENUM ('meta', 'tiktok', 'google');

-- CreateEnum
CREATE TYPE "CreativeKind" AS ENUM ('video', 'static');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('draft', 'approved', 'running', 'paused');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('todo', 'doing', 'review', 'done');

-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('main', 'bonus', 'copy', 'email', 'vsl', 'mockup', 'bump', 'upsell');

-- CreateEnum
CREATE TYPE "FunnelStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "FunnelStepType" AS ENUM ('ad', 'advertorial', 'lp', 'checkout', 'bump', 'upsell', 'thankyou');

-- CreateEnum
CREATE TYPE "OfferDraftStatus" AS ENUM ('modeling', 'ready', 'launched');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('meta', 'tiktok', 'hotmart', 'clickbank', 'urlscan', 'manual');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('open', 'promoted', 'discarded');

-- CreateEnum
CREATE TYPE "ProductStage" AS ENUM ('validation', 'production', 'funnel', 'launch', 'scaling', 'paused');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('approved', 'pending', 'waiting', 'refunded');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('sale', 'refund', 'chargeback');

-- CreateEnum
CREATE TYPE "TrendStatus" AS ENUM ('breakout', 'rising', 'stable', 'seasonal', 'declining');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "funnelId" TEXT,
    "platform" "CampaignPlatform" NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dailyBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetricDaily" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "cpaCents" INTEGER NOT NULL DEFAULT 0,
    "roas" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "CampaignMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creative" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "kind" "CreativeKind" NOT NULL,
    "hook" TEXT,
    "status" "CreativeStatus" NOT NULL DEFAULT 'draft',
    "platform" TEXT,
    "assetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "DeliverableType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'todo',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FunnelStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelStep" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "FunnelStepType" NOT NULL,
    "config" JSONB,
    "url" TEXT,

    CONSTRAINT "FunnelStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayBalance" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "pendingCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "credentialsRef" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "source" "OfferSource" NOT NULL,
    "advertiser" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "ticketEstCents" INTEGER,
    "angle" TEXT,
    "pageUrl" TEXT,
    "screenshotUrl" TEXT,
    "detectedGateway" TEXT,
    "xray" JSONB,
    "opportunityScore" INTEGER,
    "firstSeen" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "daysRunning" INTEGER NOT NULL DEFAULT 0,
    "scanCount" INTEGER,
    "activeAdsCount" INTEGER NOT NULL DEFAULT 0,
    "sampleCreatives" JSONB,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferDraft" (
    "id" TEXT NOT NULL,
    "status" "OfferDraftStatus" NOT NULL DEFAULT 'modeling',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "sourceOfferId" TEXT,
    "base" JSONB,
    "avatar" JSONB,
    "bigIdea" JSONB,
    "stack" JSONB,
    "salesCopy" JSONB,
    "creativeAngles" JSONB,
    "emailSequences" JSONB,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "demand" TEXT,
    "competition" TEXT,
    "ticketRange" TEXT,
    "sourceNotes" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'open',
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "gateway" TEXT,
    "stage" "ProductStage" NOT NULL DEFAULT 'validation',
    "brief" JSONB,
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermTrend" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "volumeMonthly" INTEGER NOT NULL DEFAULT 0,
    "growth90d" TEXT,
    "growth12m" TEXT,
    "status" "TrendStatus" NOT NULL DEFAULT 'stable',
    "series" JSONB,
    "seasonalityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermTrend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "gateway" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL DEFAULT 'sale',
    "method" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "status" "TransactionStatus" NOT NULL DEFAULT 'approved',
    "funnelStepId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetricDaily_campaignId_date_key" ON "CampaignMetricDaily"("campaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_date_key" ON "FxRate"("base", "quote", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayBalance_gateway_key" ON "GatewayBalance"("gateway");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");

-- CreateIndex
CREATE INDEX "Offer_daysRunning_idx" ON "Offer"("daysRunning");

-- CreateIndex
CREATE INDEX "Offer_market_niche_idx" ON "Offer"("market", "niche");

-- CreateIndex
CREATE INDEX "Offer_opportunityScore_idx" ON "Offer"("opportunityScore");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_source_pageUrl_key" ON "Offer"("source", "pageUrl");

-- CreateIndex
CREATE INDEX "Product_stage_idx" ON "Product"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "TermTrend_term_market_key" ON "TermTrend"("term", "market");

-- CreateIndex
CREATE INDEX "Transaction_productId_idx" ON "Transaction"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_gateway_externalId_key" ON "Transaction"("gateway", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetricDaily" ADD CONSTRAINT "CampaignMetricDaily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creative" ADD CONSTRAINT "Creative_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelStep" ADD CONSTRAINT "FunnelStep_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferDraft" ADD CONSTRAINT "OfferDraft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferDraft" ADD CONSTRAINT "OfferDraft_sourceOfferId_fkey" FOREIGN KEY ("sourceOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

