import { z } from 'zod';

export const harvestInputSchema = z.object({
  sourceId: z.string().min(1).optional(), // ausente = todas as fontes habilitadas
});
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
