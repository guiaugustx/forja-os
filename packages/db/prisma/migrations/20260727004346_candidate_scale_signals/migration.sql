-- Sinais de escala do candidato, medidos via retrieve do urlscan.
-- signalScore null = não medido; 0 = medido e sem sinal (contrato da UI).
-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "domainAgeDays" INTEGER,
ADD COLUMN     "hasAdPixel" BOOLEAN,
ADD COLUMN     "scanUuid" TEXT,
ADD COLUMN     "signalScore" INTEGER,
ADD COLUMN     "signals" JSONB,
ADD COLUMN     "tlsAgeDays" INTEGER;

-- CreateIndex
CREATE INDEX "Candidate_status_signalScore_idx" ON "Candidate"("status", "signalScore");

-- CreateIndex
CREATE INDEX "Candidate_status_hasAdPixel_signalScore_idx" ON "Candidate"("status", "hasAdPixel", "signalScore");
