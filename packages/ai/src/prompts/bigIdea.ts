import { z } from 'zod';

export const bigIdeaSchema = z.object({
  bigIdea: z.string(),
  uniqueMechanism: z.string(),
  differentiation: z.string(),
  promiseHeadline: z.string(),
});
export type BigIdeaBlock = z.infer<typeof bigIdeaSchema>;

export const BIG_IDEA_SYSTEM = [
  'Você é um copywriter de resposta direta.',
  'Usando o raio-x da oferta base e o avatar já definido, crie a GRANDE IDEIA e o',
  'MECANISMO ÚNICO da nova oferta. A grande ideia deve ser DELIBERADAMENTE diferenciada',
  'da oferta base — não competir de igual, e sim reposicionar. Explique a diferenciação.',
  'Responda SOMENTE com JSON válido com as chaves: bigIdea, uniqueMechanism,',
  'differentiation, promiseHeadline.',
].join(' ');

export const bigIdeaMock: BigIdeaBlock = {
  bigIdea: 'O "Reset de 3 Noites": reprogramar o relógio biológico, não forçar o sono.',
  uniqueMechanism: 'Protocolo circadiano em 3 fases (luz, temperatura, respiração).',
  differentiation: 'A base foca em suplementos; aqui o mecanismo é comportamental, sem pílulas.',
  promiseHeadline: 'Reprograme seu sono em 3 noites — sem remédios, sem contar carneirinhos.',
};
