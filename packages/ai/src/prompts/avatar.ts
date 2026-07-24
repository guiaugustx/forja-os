import { z } from 'zod';

export const avatarSchema = z.object({
  demographic: z.string(),
  awarenessLevel: z.string(),
  desires: z.array(z.string()),
  pains: z.array(z.string()),
  objections: z.array(z.string()),
  beliefs: z.array(z.string()),
});
export type AvatarBlock = z.infer<typeof avatarSchema>;

export const AVATAR_SYSTEM = [
  'Você é um estrategista de copy e ofertas.',
  'Com base no raio-x da oferta de referência, defina o AVATAR e a consciência do público',
  'para uma oferta NOVA, própria (modelada, não copiada).',
  'Responda SOMENTE com JSON válido com as chaves: demographic, awarenessLevel,',
  'desires (array), pains (array), objections (array), beliefs (array).',
].join(' ');

export const avatarMock: AvatarBlock = {
  demographic: 'Adultos 30–55 anos, insônia crônica, renda média, mobile-first.',
  awarenessLevel: 'Consciente do problema, ainda não da solução.',
  desires: ['Acordar descansado', 'Parar de depender de remédios', 'Ter energia no dia'],
  pains: ['Acordar de madrugada', 'Cansaço e irritação', 'Ansiedade ao deitar'],
  objections: ['Já tentei de tudo', 'Não tenho tempo', 'Será que funciona pra mim?'],
  beliefs: ['Sono é genético', 'Preciso de remédio para dormir'],
};
