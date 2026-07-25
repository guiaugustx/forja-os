/*
  Warnings:

  - You are about to drop the `SeenDomain` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "SeenDomain";

-- CreateIndex
CREATE INDEX "Candidate_status_daysRunning_idx" ON "Candidate"("status", "daysRunning");

-- CreateIndex
CREATE INDEX "Candidate_status_lastSeenAt_idx" ON "Candidate"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Candidate_status_discardReason_idx" ON "Candidate"("status", "discardReason");
