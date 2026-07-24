import { z } from 'zod';

// Raio-x da oferta: a IA lê o texto da página de vendas e destila a estrutura.
export const xraySchema = z.object({
  promise: z.string(),
  mechanism: z.string(),
  avatar: z.string(),
  pain: z.string(),
  guarantee: z.string(),
  angle: z.string(),
  niche: z.string(),
  market: z.string(),
  ticketEstCents: z.number().int().nonnegative(),
});
export type Xray = z.infer<typeof xraySchema>;

export const XRAY_SYSTEM = [
  'Você é um analista sênior de ofertas de produtos digitais de low ticket.',
  'A partir do texto de uma página de vendas, extraia a engenharia reversa da oferta.',
  'Seja específico e conciso. Estime o mercado como código curto (BR, US, ES, etc.)',
  'com base no idioma/país do texto. Estime o ticket em CENTAVOS (ex.: R$97 = 9700).',
  'Responda SOMENTE com um objeto JSON válido, sem comentários nem texto fora do JSON,',
  'com exatamente estas chaves: promise, mechanism, avatar, pain, guarantee, angle,',
  'niche, market, ticketEstCents.',
].join(' ');

export function buildXrayUser(input: { pageText: string; url?: string; title?: string }): string {
  const header = [
    input.url ? `URL: ${input.url}` : null,
    input.title ? `Título: ${input.title}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    header,
    '',
    'Texto extraído da página de vendas (pode estar truncado):',
    '"""',
    input.pageText,
    '"""',
  ].join('\n');
}

export const xrayMock: Xray = {
  promise: 'Dormir a noite inteira em 7 dias sem remédios.',
  mechanism: 'Protocolo de higiene do sono em 3 fases baseado em ritmo circadiano.',
  avatar: 'Adultos 30–55 anos com insônia crônica e cansaço diurno.',
  pain: 'Acordar às 3h da manhã e não conseguir voltar a dormir.',
  guarantee: '7 dias de garantia incondicional.',
  angle: 'Depoimento em primeira pessoa (o "acordar às 3h").',
  niche: 'saude/sono',
  market: 'BR',
  ticketEstCents: 9700,
};
