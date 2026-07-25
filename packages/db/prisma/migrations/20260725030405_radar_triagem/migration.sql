-- CreateEnum
CREATE TYPE "HarvestKind" AS ENUM ('resource', 'checkout');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('pending', 'discarded_auto', 'discarded_manual', 'promoted');

-- CreateEnum
CREATE TYPE "OfferStage" AS ENUM ('analysis', 'pipeline', 'discarded');

-- CreateEnum
CREATE TYPE "EnrichmentState" AS ENUM ('pending', 'running', 'done', 'failed');

-- AlterTable
ALTER TABLE "Offer" DROP COLUMN "saved",
ADD COLUMN     "alerts" JSONB,
ADD COLUMN     "candidateId" TEXT,
ADD COLUMN     "enrichment" "EnrichmentState" NOT NULL DEFAULT 'pending',
ADD COLUMN     "enrichmentError" TEXT,
ADD COLUMN     "stage" "OfferStage" NOT NULL DEFAULT 'analysis';

-- AlterTable
ALTER TABLE "IngestionRun" DROP COLUMN "discardedCount",
DROP COLUMN "foundCount",
DROP COLUMN "processedCount",
DROP COLUMN "savedCount",
ADD COLUMN     "autoDiscarded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "newCandidates" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedForTriage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rawHits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceId" TEXT;

-- CreateTable
CREATE TABLE "HarvestSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "kind" "HarvestKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" TEXT,
    "minHitCount" INTEGER NOT NULL DEFAULT 1,
    "maxAgeDays" INTEGER NOT NULL DEFAULT 90,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HarvestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "screenshotUrl" TEXT,
    "referer" TEXT,
    "productName" TEXT,
    "priceCents" INTEGER,
    "gateway" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "daysRunning" INTEGER NOT NULL DEFAULT 0,
    "status" "CandidateStatus" NOT NULL DEFAULT 'pending',
    "discardReason" TEXT,
    "triagedAt" TIMESTAMP(3),
    "firstRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HarvestSource_query_key" ON "HarvestSource"("query");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_dedupeKey_key" ON "Candidate"("dedupeKey");

-- CreateIndex
CREATE INDEX "Candidate_status_hitCount_idx" ON "Candidate"("status", "hitCount");

-- CreateIndex
CREATE INDEX "Candidate_sourceId_status_idx" ON "Candidate"("sourceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_candidateId_key" ON "Offer"("candidateId");

-- CreateIndex
CREATE INDEX "Offer_stage_idx" ON "Offer"("stage");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "HarvestSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_firstRunId_fkey" FOREIGN KEY ("firstRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "HarvestSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

