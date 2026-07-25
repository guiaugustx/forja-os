import OpenAI from 'openai';
import { openAiCompatibleConfig } from '../config';
import type { ChatRequest } from './types';

// Provedor para qualquer API compatível com OpenAI — hoje o OpenRouter, antes o
// SiliconFlow. Só a base_url e o modelo mudam entre eles.

let client: OpenAI | null = null;
let clientKey = '';

function getClient(apiKey: string, baseURL: string): OpenAI {
  // Recria o cliente se a configuração mudou (troca de chave em runtime, testes).
  const signature = `${apiKey}@${baseURL}`;
  if (!client || clientKey !== signature) {
    client = new OpenAI({ apiKey, baseURL });
    clientKey = signature;
  }
  return client;
}

export async function chatOpenAiCompatible(req: ChatRequest): Promise<string> {
  const cfg = openAiCompatibleConfig();
  const api = getClient(cfg.apiKey, cfg.baseURL);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: req.model ?? cfg.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    response_format: { type: 'json_object' },
    max_tokens: req.maxTokens ?? 2000,
    // Preserva o valor que o cliente antigo usava. Não existe equivalente no
    // caminho Anthropic: os modelos Opus 5 rejeitam `temperature` com 400.
    temperature: 0.7,
  };
  if (cfg.disableReasoning) params.reasoning = { enabled: false };

  const res = await api.chat.completions.create(params);
  return res.choices[0]?.message?.content ?? '{}';
}
