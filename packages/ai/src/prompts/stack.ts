import { z } from 'zod';

const item = z.object({
  name: z.string(),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
});

export const stackSchema = z.object({
  mainOffer: item,
  bump: item.optional(),
  upsell: item.optional(),
  guarantee: z.string(),
  bonuses: z.array(z.object({ name: z.string(), description: z.string() })),
});
export type OfferStackBlock = z.infer<typeof stackSchema>;

export const STACK_SYSTEM = [
  'Você é um estrategista de ofertas de low ticket.',
  'Com base na grande ideia, no mecanismo e no avatar, monte a ESTRUTURA DA OFERTA:',
  'produto principal, order bump, upsell, garantia e bônus, com precificação em CENTAVOS.',
  'Mantenha coerência com o ticket estimado da referência (low ticket).',
  'Responda SOMENTE com JSON válido com as chaves: mainOffer {name, description,',
  'priceCents}, bump {opcional}, upsell {opcional}, guarantee, bonuses (array de',
  '{name, description}).',
].join(' ');

export const stackMock: OfferStackBlock = {
  mainOffer: { name: 'Reset de 3 Noites', description: 'Protocolo completo em vídeo + PDF.', priceCents: 9700 },
  bump: { name: 'Áudios de indução', description: '7 faixas de respiração guiada.', priceCents: 2700 },
  upsell: { name: 'Mentoria 30 dias', description: 'Acompanhamento e ajustes.', priceCents: 19700 },
  guarantee: '7 dias de garantia incondicional.',
  bonuses: [
    { name: 'Checklist do quarto ideal', description: 'Luz, temperatura e ruído.' },
    { name: 'Guia de desmame de cafeína', description: 'Passo a passo de 14 dias.' },
  ],
};
