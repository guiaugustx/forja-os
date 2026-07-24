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
 * Deduplica por domínio (um domínio ≈ um anunciante/oferta) e respeita `max`.
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
  const size = Math.min(Math.max(opts.max, 1), 100);
  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&size=${size}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`urlscan search ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: RawResult[] };
  const results = json.results ?? [];

  const seenDomain = new Set<string>();
  const hits: UrlscanHit[] = [];
  for (const r of results) {
    const pageUrl = r.page?.url ?? r.task?.url;
    const domain = r.page?.domain ?? '';
    if (!pageUrl || !domain) continue;
    if (seenDomain.has(domain)) continue;
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
  return hits;
}

interface ResultDetail {
  scanCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  detectedGateway: string | null;
}

const GATEWAY_HINTS: Array<[RegExp, string]> = [
  [/cakto/i, 'cakto'],
  [/hotmart/i, 'hotmart'],
  [/stripe/i, 'stripe'],
  [/kirvano/i, 'kirvano'],
  [/monetizze/i, 'monetizze'],
];

/**
 * Detalhe de um scan: usado para detectar o gateway pelas tecnologias/domínios
 * contactados. Persistência (primeira/última vez) vem do histórico de scans do
 * domínio; aqui damos um proxy simples via nº de domínios/links.
 */
export async function getResultDetail(uuid: string): Promise<ResultDetail> {
  const empty: ResultDetail = { scanCount: null, firstSeen: null, lastSeen: null, detectedGateway: null };
  if (!uuid) return empty;
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const res = await fetch(`https://urlscan.io/api/v1/result/${uuid}/`, { headers });
  if (!res.ok) return empty;
  const json = (await res.json()) as {
    lists?: { domains?: string[] };
    meta?: { processors?: { wappa?: { data?: Array<{ app?: string }> } } };
    task?: { time?: string };
  };

  const domains = json.lists?.domains ?? [];
  const apps = (json.meta?.processors?.wappa?.data ?? []).map((a) => a.app ?? '');
  const haystack = [...domains, ...apps].join(' ');
  let detectedGateway: string | null = null;
  for (const [re, name] of GATEWAY_HINTS) {
    if (re.test(haystack)) {
      detectedGateway = name;
      break;
    }
  }

  return {
    scanCount: domains.length || null,
    firstSeen: null,
    lastSeen: json.task?.time ?? null,
    detectedGateway,
  };
}
