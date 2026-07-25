// Configuração de IA — qual provedor atende, com que chave e que modelo.
//
// O projeto passou por SiliconFlow e OpenRouter mantendo os mesmos nomes de
// variável `SILICONFLOW_*`, o que já custou uma sessão de depuração: o nome
// dizia SiliconFlow enquanto a URL apontava para outro lugar. Os nomes novos
// são `AI_*`, neutros; os antigos continuam sendo lidos para não quebrar
// ambiente nenhum.

export type AiProvider = 'anthropic' | 'openrouter';

/** Primeiro valor não vazio entre as variáveis dadas, na ordem. */
function pick(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return '';
}

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  /** Modelos de reasoning do OpenRouter truncam/vazam o JSON; desligar dá saída direta. */
  disableReasoning: boolean;
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  /** low | medium | high | xhigh | max. Vazio = padrão da API (high). */
  effort: string;
}

export function openAiCompatibleConfig(): OpenAiCompatibleConfig {
  return {
    apiKey: pick('AI_OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'SILICONFLOW_API_KEY'),
    baseURL: pick('AI_OPENAI_BASE_URL', 'SILICONFLOW_BASE_URL') || 'https://openrouter.ai/api/v1',
    model:
      pick('AI_OPENAI_MODEL', 'SILICONFLOW_MODEL') || 'nvidia/nemotron-3-super-120b-a12b:free',
    disableReasoning: pick('AI_DISABLE_REASONING').toLowerCase() === 'true',
  };
}

export function anthropicConfig(): AnthropicConfig {
  return {
    apiKey: pick('ANTHROPIC_API_KEY'),
    model: pick('ANTHROPIC_MODEL') || 'claude-opus-5',
    effort: pick('ANTHROPIC_EFFORT'),
  };
}

export function hasKey(provider: AiProvider): boolean {
  return provider === 'anthropic'
    ? anthropicConfig().apiKey.length > 0
    : openAiCompatibleConfig().apiKey.length > 0;
}

function parseProvider(raw: string): AiProvider | null {
  const v = raw.toLowerCase();
  if (v === 'anthropic' || v === 'claude') return 'anthropic';
  if (v === 'openrouter' || v === 'openai' || v === 'siliconflow') return 'openrouter';
  return null;
}

/**
 * Provedor primário. Sem `AI_PROVIDER` explícito, escolhe o que tem chave —
 * assim quem só configurou um dos dois não precisa declarar nada.
 */
export function activeProvider(): AiProvider {
  const declared = parseProvider(pick('AI_PROVIDER'));
  if (declared) return declared;
  if (hasKey('openrouter')) return 'openrouter';
  if (hasKey('anthropic')) return 'anthropic';
  return 'openrouter';
}

/**
 * Provedor de reserva, usado só quando o primário recusa por cota ou rate
 * limit. Precisa ser declarado: cair para um provedor pago sem o operador
 * saber é pior que falhar de forma visível.
 */
export function fallbackProvider(): AiProvider | null {
  const declared = parseProvider(pick('AI_FALLBACK_PROVIDER'));
  if (!declared || declared === activeProvider()) return null;
  return hasKey(declared) ? declared : null;
}
