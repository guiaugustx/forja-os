import { z } from 'zod';

export const salesCopySchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  leadParagraphs: z.array(z.string()),
  bullets: z.array(z.string()),
  offerBlock: z.string(),
  guaranteeBlock: z.string(),
  cta: z.string(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});
export type SalesCopyBlock = z.infer<typeof salesCopySchema>;

export const SALES_COPY_SYSTEM = [
  'Você é um copywriter de resposta direta especialista em páginas de vendas de low ticket.',
  'Usando avatar, grande ideia, mecanismo e estrutura da oferta, escreva a COPY da página',
  'de vendas em blocos. Tom persuasivo, claro, específico, sem promessas ilegais/absurdas.',
  'Escreva no idioma do mercado da oferta.',
  'Responda SOMENTE com JSON válido com as chaves: headline, subheadline,',
  'leadParagraphs (array), bullets (array), offerBlock, guaranteeBlock, cta,',
  'faq (array de {q, a}).',
].join(' ');

export const salesCopyMock: SalesCopyBlock = {
  headline: 'Reprograme seu sono em 3 noites — sem remédios.',
  subheadline: 'O protocolo circadiano que faz seu corpo lembrar como dormir.',
  leadParagraphs: [
    'Se você acorda às 3h da manhã e não consegue voltar a dormir, o problema não é força de vontade.',
    'É o seu relógio biológico fora de fase — e dá para reprogramá-lo em poucas noites.',
  ],
  bullets: [
    'As 3 fases que reajustam seu ritmo circadiano',
    'O erro de luz que sabota seu sono toda noite',
    'A respiração de 4 minutos que desliga a mente',
  ],
  offerBlock: 'Você recebe o protocolo completo em vídeo + PDF, os áudios de indução e os bônus.',
  guaranteeBlock: 'Teste por 7 dias. Se não dormir melhor, devolvemos 100% do valor.',
  cta: 'Quero reprogramar meu sono agora',
  faq: [
    { q: 'Funciona sem remédios?', a: 'Sim, o método é 100% comportamental.' },
    { q: 'Em quanto tempo vejo resultado?', a: 'A maioria relata melhora já na 3ª noite.' },
  ],
};
