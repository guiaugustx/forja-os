import { z } from 'zod';

export const harvestInputSchema = z
  .object({
    sourceId: z.string().min(1).optional(), // ausente = todas as fontes habilitadas
  })
  // Sem Content-Type/corpo o Nest chama parse(undefined) — dispara "todas as
  // fontes" tratando ausência de corpo como objeto vazio, não como erro 400.
  .default({});
export type HarvestInput = z.infer<typeof harvestInputSchema>;

export const triageDecisionSchema = z.object({
  decision: z.enum(['pipeline', 'analysis', 'discard']),
});
export type TriageDecision = z.infer<typeof triageDecisionSchema>;

export const bulkTriageSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  decision: z.enum(['pipeline', 'analysis', 'discard']),
});
export type BulkTriage = z.infer<typeof bulkTriageSchema>;

export const offerStageSchema = z.object({
  stage: z.enum(['analysis', 'pipeline', 'discarded']),
});
export type OfferStageInput = z.infer<typeof offerStageSchema>;

// Query string da listagem de candidatos. Nenhum parâmetro de query passava por
// validação antes disso — ?take= (presente e vazio, o que URLSearchParams produz
// naturalmente) virava Number('') = 0 e derrubava a paginação com 500. Zod aqui
// garante 400 em vez de erro cru do Prisma.
export const candidateListQuerySchema = z.object({
  status: z
    .enum(['pending', 'discarded_auto', 'discarded_manual', 'promoted'])
    .default('pending'),
  sourceId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  sort: z.enum(['days', 'recent', 'hits']).optional(),
  cursor: z.string().min(1).optional(),
  // Ausente (chave nem aparece no objeto de query) cai no default(50) do Zod,
  // que atua antes da coerção. Presente e vazio (?take=, o que URLSearchParams
  // produz naturalmente) é outra história: Number('') é 0, falha o min(1) e
  // vira 400 — não silenciosamente 50, para não mascarar um cliente quebrado
  // mandando `take=` por engano.
  take: z.coerce.number().int().min(1).max(200).default(50),
});
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;
