// Adapter do urlscan.io — descoberta de páginas de venda a partir da Search API.
// Docs: https://urlscan.io/docs/api/  ·  Auth: header API-Key.
import * as cheerio from 'cheerio';

const SEARCH_URL = 'https://urlscan.io/api/v1/search/';

import type { RawHit } from '../lib/aggregate';

interface RawResult {
  _id?: string;
  sort?: unknown[];
  page?: { url?: string; domain?: string; title?: string };
  task?: { url?: string; time?: string; referer?: string };
}

export interface SearchPage {
  hits: RawHit[];
  nextCursor: string | null;
  pageSize: number;
}

function apiKey(): string {
  return process.env.URLSCAN_API_KEY ?? '';
}

/**
 * Converte a resposta da Search API em hits crus. Separado da requisição para
 * ser testável sem rede — o parsing é onde mora o risco, não o fetch.
 *
 * Nada é deduplicado aqui: hits repetidos da mesma página são o sinal de
 * circulação e quem agrega é `aggregateHits`.
 */
export function parseSearchResponse(json: unknown): SearchPage {
  const results = (json as { results?: RawResult[] })?.results ?? [];
  const hits: RawHit[] = [];

  for (const r of results) {
    const pageUrl = r.page?.url ?? r.task?.url;
    const pageDomain = r.page?.domain;
    if (!pageUrl || !pageDomain) continue;
    hits.push({
      uuid: r._id ?? '',
      pageUrl,
      pageDomain,
      title: r.page?.title ?? pageDomain,
      time: r.task?.time ?? null,
      referer: r.task?.referer ?? null,
    });
  }

  const last = results[results.length - 1];
  const nextCursor = last?.sort?.length ? last.sort.join(',') : null;
  return { hits, nextCursor, pageSize: results.length };
}

/**
 * Uma página de resultados. O cursor (`search_after`) é persistido em
 * HarvestSource, então cada rodada continua de onde a anterior parou em vez de
 * re-varrer o topo dos 10.000 resultados.
 *
 * Sem filtro de data: o cursor já dá a progressão, e um `date:>now-Nd` colidiria
 * com ele — a varredura anda para trás no tempo e o filtro cortaria justamente o
 * trecho ainda não visitado.
 */
export async function searchPage(opts: {
  query: string;
  cursor: string | null;
  size?: number;
}): Promise<SearchPage> {
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const size = opts.size ?? 100;
  let url = `${SEARCH_URL}?q=${encodeURIComponent(opts.query)}&size=${size}`;
  if (opts.cursor) url += `&search_after=${encodeURIComponent(opts.cursor)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`urlscan search ${res.status}: ${body.slice(0, 200)}`);
  }
  return parseSearchResponse(await res.json());
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

/**
 * Texto do DOM RENDERIZADO pelo urlscan (o scanner já executou o JS da página).
 * Usado quando o fetch cru vem vazio/fino — corrige páginas SPA/JS.
 */
export async function getDomText(uuid: string): Promise<string> {
  if (!uuid) return '';
  const key = apiKey();
  const headers: Record<string, string> = {};
  if (key) headers['API-Key'] = key;
  try {
    const res = await fetch(`https://urlscan.io/dom/${uuid}/`, { headers });
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, nav, footer, header').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 12000);
  } catch {
    return '';
  }
}
