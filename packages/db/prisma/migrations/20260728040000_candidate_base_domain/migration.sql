-- Nome registrável sem sufixo público, para agrupar spray de TLD na triagem.
-- Só populado para candidatos de fonte RESOURCE (checkout fica null).
ALTER TABLE "Candidate" ADD COLUMN "baseDomain" TEXT;

-- Agrupamento por baseDomain dentro de uma partição de status (pending).
CREATE INDEX "Candidate_status_baseDomain_idx" ON "Candidate"("status", "baseDomain");
