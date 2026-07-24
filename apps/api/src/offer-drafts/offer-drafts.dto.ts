import { z } from 'zod';

export const stepKeySchema = z.enum(['avatar', 'bigIdea', 'stack', 'salesCopy']);

export const createDraftSchema = z.object({
  sourceOfferId: z.string().min(1).optional(),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const patchStepSchema = z.object({
  step: stepKeySchema,
  data: z.unknown(),
});
export type PatchStepInput = z.infer<typeof patchStepSchema>;

export const generateSchema = z.object({ step: stepKeySchema });
export type GenerateInput = z.infer<typeof generateSchema>;
