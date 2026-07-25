// Adapter do urlscan.io — descoberta de páginas de venda a partir da Search API.
// Docs: https://urlscan.io/docs/api/  ·  Auth: header API-Key.

const SEARCH_URL = 'https://urlscan.io/api/v1/search/';

export interface UrlscanHit {
  uuid: string;
  pageUrl: string;
  domain: string;
  title: string;
  time: string | null;
  screenshotUrl: string | null;
  sort: unknown[] | undefined; // usado para paginação (search_after)
}

interface RawResult {
  _id?: string;
  sort?: unknown[];
  page?: { url?: string; domain?: string; title?: string };
  task?: { url?: string; time?: string };
  screenshot?: string;
}

function apiKey(): string {
  return process.env.URLSCAN_API_KEY ?? '';
}

/**
 * Busca páginas que casam com a query (ex.: `domain:cdn.utmify.com.br`).
 * Deduplica por domínio (um domínio ≈ um anunciante/oferta) e PAGINA (search_after)
 * até juntar `max` domínios únicos — os produtos digitais são minoria, então é
 * preciso vasculhar mais fundo do que uma página de 100 resultados.
 */
export async function searchOffers(opts: {
  query: string;
  lookbackDays: number;
  max: number;
}): Promise<UrlscanHit[]> {
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const q = `${opts.query} AND date:>now-${opts.lookbackDays}d`;
  const pageSize = 100;
  const maxPages = 12; // trava de segurança (~1200 resultados brutos)

  const seenDomain = new Set<string>();
  const hits: UrlscanHit[] = [];
  let searchAfter: string | null = null;

  for (let page = 0; page < maxPages && hits.length < opts.max; page++) {
    let url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&size=${pageSize}`;
    if (searchAfter) url += `&search_after=${encodeURIComponent(searchAfter)}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (page === 0) throw new Error(`urlscan search ${res.status}: ${body.slice(0, 200)}`);
      break;
    }
    const json = (await res.json()) as { results?: RawResult[] };
    const results = json.results ?? [];
    if (results.length === 0) break;

    for (const r of results) {
      const pageUrl = r.page?.url ?? r.task?.url;
      const domain = r.page?.domain ?? '';
      if (!pageUrl || !domain || seenDomain.has(domain)) continue;
      seenDomain.add(domain);
      hits.push({
        uuid: r._id ?? '',
        pageUrl,
        domain,
        title: r.page?.title ?? domain,
        time: r.task?.time ?? null,
        screenshotUrl: r._id ? `https://urlscan.io/screenshots/${r._id}.png` : null,
        sort: r.sort,
      });
      if (hits.length >= opts.max) break;
    }

    const last = results[results.length - 1];
    if (results.length < pageSize || !last?.sort || last.sort.length === 0) break;
    searchAfter = last.sort.join(',');
  }

  return hits;
}

export interface DomainActivity {
  scanCount: number; // quantas vezes o domínio foi escaneado no urlscan (proxy de circulação)
  firstSeen: string | null;
  lastSeen: string | null;
}

/**
 * Atividade/circulação do domínio no urlscan — proxy de tráfego: uma página que é
 * escaneada várias vezes e recentemente está sendo acessada/compartilhada de verdade.
 */
export async function getDomainActivity(domain: string): Promise<DomainActivity> {
  const empty: DomainActivity = { scanCount: 0, firstSeen: null, lastSeen: null };
  if (!domain) return empty;
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const url = `${SEARCH_URL}?q=${encodeURIComponent(`page.domain:${domain}`)}&size=100`;
  const res = await fetch(url, { headers });
  if (!res.ok) return empty;
  const json = (await res.json()) as { results?: Array<{ task?: { time?: string } }>; total?: number };
  const results = json.results ?? [];
  const times = results.map((r) => r.task?.time).filter(Boolean) as string[];
  times.sort();
  return {
    scanCount: json.total ?? results.length,
    firstSeen: times[0] ?? null,
    lastSeen: times[times.length - 1] ?? null,
  };
}
