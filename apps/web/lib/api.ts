const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

// Erro de API que carrega o status HTTP de forma acessível a quem chama —
// a página usa isso para, por exemplo, tratar um 409 (regra de negócio)
// diferente de um 500 (infra) sem precisar reabrir o corpo da resposta.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// O Nest devolve `{ statusCode, message, error }` no corpo de toda resposta de
// erro — inclusive as mensagens em português escritas para um humano ler (ex.:
// "Este candidato já foi triado"). Perder esse corpo e reportar só o status
// HTTP é o que fazia o operador ver "API PATCH ... → 409" em vez da explicação
// real. Se o corpo não vier em formato utilizável, cai num texto genérico.
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'message' in body) {
      const { message } = body as { message?: unknown };
      if (typeof message === 'string' && message.length > 0) return message;
      if (Array.isArray(message) && message.length > 0 && typeof message[0] === 'string') {
        return message.join('; ');
      }
    }
  } catch {
    // corpo não era JSON (ou já foi consumido) — segue para o fallback
  }
  return fallback;
}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new ApiError(await readErrorMessage(res, `API ${path} → ${res.status}`), res.status);
  }
  return res.json() as Promise<T>;
}

async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new ApiError(
      await readErrorMessage(res, `API ${method} ${path} → ${res.status}`),
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

export const apiPost = <T>(path: string, body?: unknown) => mutate<T>(path, 'POST', body);
export const apiPatch = <T>(path: string, body?: unknown) => mutate<T>(path, 'PATCH', body);

export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
