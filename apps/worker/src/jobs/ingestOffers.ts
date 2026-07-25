import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { searchOffers, getDomainActivity, type UrlscanHit } from '../adapters/urlscan';
import { fetchAndExtract } from '../adapters/salesPage';
import { fetchTrend } from '../adapters/trends';
import { computeScore } from '../lib/score';
import { isBlockedCategory, looksLikeSalesPage, computeTraffic } from '../lib/filters';

export interface IngestJobData {
  runId?: string;
  query?: string;
  lookbackDays?: number;
  max?: number;
}

interface IngestEvent {
  domain: string;
  ok: boolean;
  reason?: string;
}

function parseGrowth(pct: string | null): number | null {
  if (!pct) return null;
  const n = Number(pct.replace(/[+%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function ingestOffers(job: Job<IngestJobData>) {
  const query = job.data.query || process.env.URLSCAN_QUERY || 'domain:cdn.utmify.com.br';
  const lookbackDays = job.data.lookbackDays ?? Number(process.env.INGEST_LOOKBACK_DAYS ?? 7);
  const max = job.data.max ?? Number(process.env.INGEST_MAX_OFFERS ?? 20);

  let runId = job.data.runId;
  if (!runId) {
    const run = await prisma.ingestionRun.create({ data: { query, status: 'running' } });
    runId = run.id;
  }

  let found = 0;
  let processed = 0;
  let saved = 0;
  let discarded = 0;
  const events: IngestEvent[] = [];

  // Atualiza o registro da rodada para o loader consumir por polling.
  const progress = (stage: string) =>
    prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        stage,
        foundCount: found,
        processedCount: processed,
        savedCount: saved,
        discardedCount: discarded,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
      },
    });

  try {
    await progress('🔎 Buscando páginas no urlscan…');

    const hits = await searchOffers({ query, lookbackDays, max });
    found = hits.length;
    await progress(found ? `${found} páginas encontradas. Analisando…` : 'Nenhuma página encontrada.');

    for (const hit of hits) {
      await progress(`🧠 Analisando ${hit.domain}…`);
      let outcome: { ok: boolean; reason?: string };
      try {
        outcome = await processCandidate(hit);
      } catch (err) {
        outcome = { ok: false, reason: `erro: ${(err as Error).message}` };
      }
      processed++;
      if (outcome.ok) {
        saved++;
        events.unshift({ domain: hit.domain, ok: true });
      } else {
        discarded++;
        events.unshift({ domain: hit.domain, ok: false, reason: outcome.reason });
        console.log(`[ingest] descartada (${outcome.reason}): ${hit.pageUrl}`);
      }
      if (events.length > 24) events.length = 24;
    }

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'done',
        stage: `Concluído — ${saved} salvas, ${discarded} descartadas`,
        foundCount: found,
        processedCount: processed,
        savedCount: saved,
        discardedCount: discarded,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return { ok: true, found, saved, discarded };
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'error',
        stage: 'Falha na ingestão',
        foundCount: found,
        processedCount: processed,
        savedCount: saved,
        discardedCount: discarded,
        error: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

// Processa um candidato: aplica os gates (página viva → não-delivery → página de
// vendas → digital → tráfego) e, se passar, grava/atualiza a Offer.
async function processCandidate(hit: UrlscanHit): Promise<{ ok: boolean; reason?: string }> {
  const page = await fetchAndExtract(hit.pageUrl);
  if (!page.ok) return { ok: false, reason: 'sem-conteudo' };

  if (isBlockedCategory(hit.domain, page.title)) return { ok: false, reason: 'delivery-comida' };

  if (!looksLikeSalesPage({ hasCheckout: page.hasCheckout, hasPrice: page.hasPrice, textLen: page.text.length })) {
    return { ok: false, reason: 'nao-e-pagina-de-vendas' };
  }

  const xray = await extractXray({ pageText: page.text, url: hit.pageUrl, title: hit.title });
  if (!xray.isSalesPage) return { ok: false, reason: 'nao-e-pagina-de-vendas' };
  if (xray.productType !== 'digital') return { ok: false, reason: `produto-${xray.productType}` };
  if (isBlockedCategory(xray.category, xray.niche, hit.title)) return { ok: false, reason: 'delivery-comida' };

  const activity = await getDomainActivity(hit.domain);
  const traffic = computeTraffic({
    pixels: page.pixels,
    domainScanCount: activity.scanCount,
    lastSeen: activity.lastSeen,
  });
  if (!traffic.hasTraffic) return { ok: false, reason: 'sem-trafego' };

  const firstSeen = activity.firstSeen ? new Date(activity.firstSeen) : null;
  const lastSeen = activity.lastSeen ? new Date(activity.lastSeen) : hit.time ? new Date(hit.time) : new Date();
  const daysRunning = firstSeen ? Math.max(0, Math.round((lastSeen.getTime() - firstSeen.getTime()) / 86400000)) : 0;

  const niche = xray.niche || 'desconhecido';
  const market = xray.market || 'BR';
  const competitionCount = await prisma.offer.count({ where: { niche, market } });

  const trend = await fetchTrend(niche, market);
  if (trend) {
    const series = trend.series as unknown as Prisma.InputJsonValue;
    await prisma.termTrend.upsert({
      where: { term_market: { term: trend.term, market: trend.market } },
      update: { volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
      create: { term: trend.term, market: trend.market, volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
    });
  }

  const score = computeScore({
    trafficScore: traffic.score,
    daysRunning,
    scanCount: activity.scanCount,
    ticketEstCents: xray.ticketEstCents,
    competitionCount: competitionCount + 1,
    demandGrowthPct: parseGrowth(trend?.growth90d ?? null),
  });

  const xrayJson = xray as unknown as Prisma.InputJsonValue;

  await prisma.offer.upsert({
    where: { source_pageUrl: { source: 'urlscan', pageUrl: hit.pageUrl } },
    update: {
      advertiser: hit.domain,
      name: hit.title || hit.domain,
      market,
      niche,
      ticketEstCents: xray.ticketEstCents,
      angle: xray.angle,
      screenshotUrl: hit.screenshotUrl,
      detectedGateway: page.detectedGateway,
      xray: xrayJson,
      opportunityScore: score,
      trafficScore: traffic.score,
      daysRunning,
      scanCount: activity.scanCount,
      lastSeen,
    },
    create: {
      source: 'urlscan',
      advertiser: hit.domain,
      name: hit.title || hit.domain,
      market,
      niche,
      ticketEstCents: xray.ticketEstCents,
      angle: xray.angle,
      pageUrl: hit.pageUrl,
      screenshotUrl: hit.screenshotUrl,
      detectedGateway: page.detectedGateway,
      xray: xrayJson,
      opportunityScore: score,
      trafficScore: traffic.score,
      daysRunning,
      scanCount: activity.scanCount,
      firstSeen,
      lastSeen,
    },
  });

  return { ok: true };
}
