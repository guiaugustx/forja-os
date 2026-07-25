// Contrato que todo provedor de IA implementa. O resto do projeto só conhece
// `chatJSON` — trocar de provedor não toca em nenhum prompt nem em nenhum job.

export interface ChatRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

/** Devolve o texto cru do modelo; extrair e validar o JSON é responsabilidade do cliente. */
export type ChatProvider = (req: ChatRequest) => Promise<string>;

/**
 * Erro de cota ou rate limit — a única classe de falha que justifica cair para
 * o provedor de reserva. Falha de rede, JSON inválido ou chave errada não
 * justificam: trocar de provedor não conserta nenhuma das três e só esconderia
 * o problema real.
 */
export class QuotaError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

const QUOTA_HINTS = /insufficient|balance|quota|credit|rate.?limit|exceeded|too many requests/i;

/**
 * Classifica o erro de um SDK compatível com OpenAI ou da Anthropic.
 *
 * 429 é rate limit em qualquer provedor. 402 é pagamento exigido. O 403 é
 * ambíguo — pode ser chave sem permissão ou saldo zerado (o SiliconFlow devolve
 * `code 30001, "account balance is insufficient"` com 403) — então só conta
 * como cota quando a mensagem diz isso.
 */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof QuotaError) return true;
  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === 'number' ? e.status : 0;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (status === 429 || status === 402) return true;
  if (status === 403 && QUOTA_HINTS.test(message)) return true;
  return false;
}
