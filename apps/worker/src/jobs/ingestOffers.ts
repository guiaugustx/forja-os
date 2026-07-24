import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { searchOffers, getResultDetail } from '../adapters/urlscan';
import { fetchAndExtract } from '../adapters/salesPage';
import { fetchTrend } from '../adapters/trends';
import { computeScore } from '../lib/score';

export interface IngestJobData {
  runId?: string;
  query?: string;
  lookbackDays?: number;
  max?: number;
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

  // Rastreio da rodada (a API pode ter criado uma; senão, criamos aqui).
  let runId = job.data.runId;
  if (!runId) {
    const run = await prisma.ingestionRun.create({ data: { query, status: 'running' } });
    runId = run.id;
  }

  let found = 0;
  let saved = 0;

  try {
    const hits = await searchOffers({ query, lookbackDays, max });
    found = hits.length;

    for (const hit of hits) {
      try {
        const page = await fetchAndExtract(hit.pageUrl);
        const detail = await getResultDetail(hit.uuid);

        const xray = page.ok
          ? await extractXray({ pageText: page.text, url: hit.pageUrl, title: hit.title })
          : null;

        const niche = xray?.niche ?? 'desconhecido';
        const market = xray?.market ?? 'BR';
        const competitionCount = await prisma.offer.count({ where: { niche, market } });

        const trend = xray ? await fetchTrend(niche, market) : null;
        if (trend) {
          const series = trend.series as unknown as Prisma.InputJsonValue;
          await prisma.termTrend.upsert({
            where: { term_market: { term: trend.term, market: trend.market } },
            update: { volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
            create: {
              term: trend.term,
              market: trend.market,
              volumeMonthly: trend.volumeMonthly,
              growth90d: trend.growth90d,
              status: trend.status,
              series,
            },
          });
        }

        // urlscan não fornece "dias no ar" de anúncio; usamos o nº de scans como
        // proxy de persistência (documentado no plano). Sinais reais → Meta Ad Library.
        const daysRunning = Math.min((detail.scanCount ?? 1) * 3, 365);

        const score = computeScore({
          daysRunning,
          scanCount: detail.scanCount,
          ticketEstCents: xray?.ticketEstCents ?? null,
          competitionCount: competitionCount + 1,
          demandGrowthPct: parseGrowth(trend?.growth90d ?? null),
        });

        const xrayJson = xray ? (xray as unknown as Prisma.InputJsonValue) : undefined;
        const seenAt = hit.time ? new Date(hit.time) : new Date();

        await prisma.offer.upsert({
          where: { source_pageUrl: { source: 'urlscan', pageUrl: hit.pageUrl } },
          update: {
            advertiser: hit.domain,
            name: hit.title || hit.domain,
            market,
            niche,
            ticketEstCents: xray?.ticketEstCents ?? null,
            angle: xray?.angle ?? null,
            screenshotUrl: hit.screenshotUrl,
            detectedGateway: detail.detectedGateway,
            ...(xrayJson ? { xray: xrayJson } : {}),
            opportunityScore: score,
            daysRunning,
            scanCount: detail.scanCount,
            lastSeen: seenAt,
          },
          create: {
            source: 'urlscan',
            advertiser: hit.domain,
            name: hit.title || hit.domain,
            market,
            niche,
            ticketEstCents: xray?.ticketEstCents ?? null,
            angle: xray?.angle ?? null,
            pageUrl: hit.pageUrl,
            screenshotUrl: hit.screenshotUrl,
            detectedGateway: detail.detectedGateway,
            ...(xrayJson ? { xray: xrayJson } : {}),
            opportunityScore: score,
            daysRunning,
            scanCount: detail.scanCount,
            firstSeen: seenAt,
            lastSeen: seenAt,
          },
        });
        saved++;
      } catch (err) {
        console.error(`[ingest] falha na oferta ${hit.pageUrl}:`, (err as Error).message);
      }
    }

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: { status: 'done', foundCount: found, savedCount: saved, finishedAt: new Date() },
    });
    return { ok: true, found, saved };
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'error',
        foundCount: found,
        savedCount: saved,
        error: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
