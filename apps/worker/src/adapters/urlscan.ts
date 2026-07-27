// Adapter do urlscan.io — descoberta de páginas de venda a partir da Search API.
// Docs: https://urlscan.io/docs/api/  ·  Auth: header API-Key.
import * as cheerio from 'cheerio';

const SEARCH_URL = 'https://urlscan.io/api/v1/search/';

import type { RawHit } from '../lib/aggregate';

interface RawResult {
  _id?: string;
  sort?: unknown[];
  page?: {
    url?: string;
    domain?: string;
    title?: string;
    domainAgeDays?: number;
    apexDomainAgeDays?: number;
    tlsAgeDays?: number;
  };
  task?: { url?: string; time?: string; referer?: string };
}

/** Número finito ou null — a API às vezes omite ou devolve lixo nesses campos. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
      // Preferir a idade do subdomínio quando existir; o apex é o fallback —
      // num lovable.app/vercel.app o apex é velho (da plataforma), e é a idade
      // do subdomínio que diz quando ESTA página nasceu.
      domainAgeDays: finiteOrNull(r.page?.domainAgeDays) ?? finiteOrNull(r.page?.apexDomainAgeDays),
      tlsAgeDays: finiteOrNull(r.page?.tlsAgeDays),
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

// ============================================================
// Retrieve de resultado — a fonte dos SINAIS DE ESCALA
// ============================================================
//
// GET /api/v1/result/{uuid}/ devolve o scan completo, incluindo lists.domains
// (todos os domínios que a página CONTATOU — é aqui que pixel de anúncio
// aparece sem baixar página nenhuma) e lists.linkDomains (domínios LINKADOS —
// é aqui que checkout aparece, porque link não gera requisição).
//
// Cota própria: retrieve = 10.000/dia, separada das 1.000 buscas/dia que a
// colheita usa e divide com a VPS. 1 retrieve por candidato é viável.

export class UrlscanRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlscanRateLimitError';
  }
}

export interface ScanResult {
  domains: string[]; // lists.domains — domínios contatados durante o scan
  linkDomains: string[]; // lists.linkDomains — domínios linkados na página
  malicious: boolean; // veredito do próprio urlscan
  domainAgeDays: number | null;
  tlsAgeDays: number | null;
  httpStatus: number | null; // page.status — status HTTP da página no momento do scan
}

/** Parse puro do resultado — separado do fetch para ser testável sem rede. */
export function parseScanResult(json: unknown): ScanResult {
  const d = json as {
    lists?: { domains?: unknown[]; linkDomains?: unknown[] };
    verdicts?: { overall?: { malicious?: boolean } };
    page?: { domainAgeDays?: number; apexDomainAgeDays?: number; tlsAgeDays?: number; status?: unknown };
  };
  const strings = (v: unknown[] | undefined): string[] =>
    (v ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0);
  // page.status vem como string ("200", "404") no JSON do urlscan — coerção
  // via Number, mas finiteOrNull descarta "" / não-numérico → null (não medido).
  const rawStatus = d?.page?.status;
  const httpStatus = finiteOrNull(
    typeof rawStatus === 'string' && rawStatus.trim() !== '' ? Number(rawStatus) : rawStatus,
  );
  return {
    domains: strings(d?.lists?.domains),
    linkDomains: strings(d?.lists?.linkDomains),
    malicious: d?.verdicts?.overall?.malicious === true,
    domainAgeDays:
      finiteOrNull(d?.page?.domainAgeDays) ?? finiteOrNull(d?.page?.apexDomainAgeDays),
    tlsAgeDays: finiteOrNull(d?.page?.tlsAgeDays),
    httpStatus,
  };
}

/**
 * Busca o resultado completo de um scan.
 * - 404/410 → null (scan expirado/removido — acontece em scans antigos).
 * - 429 → UrlscanRateLimitError, para o chamador PARAR o pass sem falhar a rodada.
 */
export async function getScanResult(uuid: string): Promise<ScanResult | null> {
  if (!uuid) return null;
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const res = await fetch(`https://urlscan.io/api/v1/result/${uuid}/`, { headers });
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 429) {
    throw new UrlscanRateLimitError(`urlscan retrieve 429 para ${uuid}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`urlscan result ${res.status}: ${body.slice(0, 160)}`);
  }
  return parseScanResult(await res.json());
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
