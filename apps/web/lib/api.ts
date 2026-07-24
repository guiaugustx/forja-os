const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const apiPost = <T>(path: string, body?: unknown) => mutate<T>(path, 'POST', body);
export const apiPatch = <T>(path: string, body?: unknown) => mutate<T>(path, 'PATCH', body);

export const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
