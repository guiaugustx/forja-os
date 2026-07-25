import OpenAI from 'openai';
import type { ZodType } from 'zod';

// Cliente único do SiliconFlow (API compatível com OpenAI). Reutilizado pela API
// (gerador) e pelo worker (raio-x na ingestão). Tudo configurável por env.
const apiKey = process.env.SILICONFLOW_API_KEY ?? '';
const baseURL = process.env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.com/v1';

export const MODEL = process.env.SILICONFLOW_MODEL ?? 'Qwen/Qwen2.5-72B-Instruct';

// Modelos de "reasoning" (OpenRouter) gastam tokens pensando e truncam/vazam o JSON.
// Com AI_DISABLE_REASONING=true, mandamos reasoning:{enabled:false} para saída direta.
const disableReasoning = (process.env.AI_DISABLE_REASONING ?? '').toLowerCase() === 'true';

// Sem chave → modo simulado (devolve mocks coerentes) para o fluxo rodar em dev.
export const isSimulated = apiKey.length === 0;

const client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

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
  /** Retorno determinístico usado quando não há SILICONFLOW_API_KEY. */
  mock: T;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function chatJSON<T>(opts: ChatJsonOptions<T>): Promise<T> {
  if (!client) {
    return opts.schema.parse(opts.mock);
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];

  const res = await client.chat.completions.create({
    model: opts.model ?? MODEL,
    messages,
    response_format: { type: 'json_object' },
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2000,
  });

  const text = res.choices[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new Error(`IA retornou JSON inválido: ${text.slice(0, 200)}`);
  }
  return opts.schema.parse(parsed);
}
