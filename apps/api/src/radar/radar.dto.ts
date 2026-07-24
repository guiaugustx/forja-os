import { z } from 'zod';

export const ingestInputSchema = z.object({
  query: z.string().min(1).optional(),
  lookbackDays: z.number().int().positive().max(90).optional(),
  max: z.number().int().positive().max(100).optional(),
});
export type IngestInput = z.infer<typeof ingestInputSchema>;

export const offerCurationSchema = z.object({ saved: z.boolean() });
export type OfferCuration = z.infer<typeof offerCurationSchema>;
