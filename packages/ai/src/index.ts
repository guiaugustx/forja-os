export * from './client';
export * from './prompts/xray';
export * from './prompts/avatar';
export * from './prompts/bigIdea';
export * from './prompts/stack';
export * from './prompts/salesCopy';

import { chatJSON } from './client';
import { xraySchema, buildXrayUser, XRAY_SYSTEM, xrayMock, type Xray } from './prompts/xray';
import { avatarSchema, AVATAR_SYSTEM, avatarMock, type AvatarBlock } from './prompts/avatar';
import { bigIdeaSchema, BIG_IDEA_SYSTEM, bigIdeaMock, type BigIdeaBlock } from './prompts/bigIdea';
import { stackSchema, STACK_SYSTEM, stackMock, type OfferStackBlock } from './prompts/stack';
import { salesCopySchema, SALES_COPY_SYSTEM, salesCopyMock, type SalesCopyBlock } from './prompts/salesCopy';

export type GeneratorStepKey = 'avatar' | 'bigIdea' | 'stack' | 'salesCopy';
export const STEP_KEYS: GeneratorStepKey[] = ['avatar', 'bigIdea', 'stack', 'salesCopy'];

// Contexto acumulado do draft, passado a cada etapa de geração.
export interface DraftContext {
  base?: { xray?: Xray | null; salesPageUrl?: string | null; notes?: string | null } | null;
  avatar?: AvatarBlock | null;
  bigIdea?: BigIdeaBlock | null;
  stack?: OfferStackBlock | null;
  salesCopy?: SalesCopyBlock | null;
}

const MAX_PAGE_TEXT = 12000;

export async function extractXray(input: {
  pageText: string;
  url?: string;
  title?: string;
}): Promise<Xray> {
  const pageText = (input.pageText ?? '').slice(0, MAX_PAGE_TEXT);
  return chatJSON({
    system: XRAY_SYSTEM,
    user: buildXrayUser({ ...input, pageText }),
    schema: xraySchema,
    mock: xrayMock,
    maxTokens: 1200,
  });
}

function contextBlock(draft: DraftContext): string {
  const parts: string[] = [];
  if (draft.base?.xray) parts.push('RAIO-X DA OFERTA BASE:\n' + JSON.stringify(draft.base.xray, null, 2));
  if (draft.avatar) parts.push('AVATAR:\n' + JSON.stringify(draft.avatar, null, 2));
  if (draft.bigIdea) parts.push('GRANDE IDEIA:\n' + JSON.stringify(draft.bigIdea, null, 2));
  if (draft.stack) parts.push('ESTRUTURA DA OFERTA:\n' + JSON.stringify(draft.stack, null, 2));
  return parts.length ? parts.join('\n\n') : '(sem contexto acumulado ainda)';
}

export type GeneratedBlock = AvatarBlock | BigIdeaBlock | OfferStackBlock | SalesCopyBlock;

export async function generateStep(step: GeneratorStepKey, draft: DraftContext): Promise<GeneratedBlock> {
  const context = contextBlock(draft);
  const user = `Contexto acumulado até aqui:\n\n${context}\n\nGere a etapa solicitada agora, coerente com o contexto.`;

  switch (step) {
    case 'avatar':
      return chatJSON({ system: AVATAR_SYSTEM, user, schema: avatarSchema, mock: avatarMock, maxTokens: 1200 });
    case 'bigIdea':
      return chatJSON({ system: BIG_IDEA_SYSTEM, user, schema: bigIdeaSchema, mock: bigIdeaMock, maxTokens: 1200 });
    case 'stack':
      return chatJSON({ system: STACK_SYSTEM, user, schema: stackSchema, mock: stackMock, maxTokens: 1400 });
    case 'salesCopy':
      return chatJSON({ system: SALES_COPY_SYSTEM, user, schema: salesCopySchema, mock: salesCopyMock, maxTokens: 2600 });
    default:
      throw new Error(`Etapa de geração desconhecida: ${step}`);
  }
}
