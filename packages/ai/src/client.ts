import type { ZodType } from 'zod';
import {
  activeProvider,
  anthropicConfig,
  fallbackProvider,
  hasKey,
  openAiCompatibleConfig,
  type AiProvider,
} from './config';
import { chatAnthropic } from './providers/anthropic';
import { chatOpenAiCompatible } from './providers/openaiCompatible';
import { isQuotaError, type ChatRequest } from './providers/types';

// Ponto único por onde toda a IA do projeto passa. Quem chama (raio-x da
// ingestão, etapas do gerador) não sabe qual provedor está atendendo — trocar
// entre Claude e OpenRouter é configuração, não código.

export { activeProvider, fallbackProvider } from './config';
export type { AiProvider } from './config';

/** Modelo do provedor ativo. Exposto para log e telas de diagnóstico. */
export function activeModel(): string {
  return activeProvider() === 'anthropic'
    ? anthropicConfig().model
    : openAiCompatibleConfig().model;
}

/**
 * Sem chave nenhuma → modo simulado: devolve os mocks para o fluxo rodar em
 * dev. É deliberadamente silencioso, então cuidado: uma chave vazia produz um
 * dossiê preenchido e falso, em vez de um erro visível.
 */
export function isSimulated(): boolean {
  return !hasKey(activeProvider());
}

function chatWith(provider: AiProvider, req: ChatRequest): Promise<string> {
  return provider === 'anthropic' ? chatAnthropic(req) : chatOpenAiCompatible(req);
}

// Alguns modelos embrulham o JSON em cercas ```json``` ou texto. Extrai o objeto.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body.trim();
}

export interface ChatJsonOptions<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  /** Retorno determinístico usado quando não há chave de provedor nenhuma. */
  mock: T;
  model?: string;
  maxTokens?: number;
}

export async function chatJSON<T>(opts: ChatJsonOptions<T>): Promise<T> {
  if (isSimulated()) return opts.schema.parse(opts.mock);

  const req: ChatRequest = {
    system: opts.system,
    user: opts.user,
    model: opts.model,
    maxTokens: opts.maxTokens,
  };

  const primary = activeProvider();
  let text: string;

  try {
    text = await chatWith(primary, req);
  } catch (err) {
    const reserve = fallbackProvider();
    // Só cota e rate limit justificam a reserva. Chave errada, rede fora ou
    // modelo inexistente falhariam igual no outro provedor — cair neles só
    // dobraria o tempo até o operador ver o erro de verdade.
    if (!reserve || !isQuotaError(err)) throw err;
    console.warn(
      `[ai] ${primary} recusou por cota (${(err as Error).message}); tentando ${reserve}.`,
    );
    text = await chatWith(reserve, req);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new Error(`IA retornou JSON inválido: ${text.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}
