import Anthropic from '@anthropic-ai/sdk';
import { anthropicConfig } from '../config';
import type { ChatRequest } from './types';

// Provedor da API da Anthropic (Claude). Três diferenças em relação ao caminho
// compatível com OpenAI, todas obrigatórias e não opcionais:
//
// 1. `temperature` é rejeitada com 400 nos modelos Opus 5 — não é enviada.
// 2. O prompt de sistema vai no campo `system`, fora do array de mensagens.
// 3. O thinking vem LIGADO por padrão no Opus 5, e `max_tokens` limita
//    thinking + resposta juntos. Os budgets dos prompts (1.200 a 2.600) foram
//    dimensionados para um modelo sem thinking e truncariam a resposta no meio,
//    então aqui vale um teto próprio e folgado — é limite, não gasto: o modelo
//    só consome o que precisar.

const MIN_MAX_TOKENS = 16_000;

let client: Anthropic | null = null;
let clientKey = '';

function getClient(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

export async function chatAnthropic(req: ChatRequest): Promise<string> {
  const cfg = anthropicConfig();
  const api = getClient(cfg.apiKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: req.model ?? cfg.model,
    max_tokens: Math.max(req.maxTokens ?? 2000, MIN_MAX_TOKENS),
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  };
  if (cfg.effort) params.output_config = { effort: cfg.effort };

  const res = await api.messages.create(params);

  // A resposta pode trazer blocos de thinking antes do texto; só o texto interessa.
  return res.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();
}
