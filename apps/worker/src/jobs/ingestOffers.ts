import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { searchOffers, getDomainActivity } from '../adapters/urlscan';
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
  let saved = 0;
  let discarded = 0;
  const drop = (url: string, reason: string) => {
    discarded++;
    console.log(`[ingest] descartada (${reason}): ${url}`);
  };

  try {
    const hits = await searchOffers({ query, lookbackDays, max });
    found = hits.length;

    for (const hit of hits) {
      try {
        // 1) precisa ser uma página acessível
        const page = await fetchAndExtract(hit.pageUrl);
        if (!page.ok) {
          drop(hit.pageUrl, 'sem-conteudo');
          continue;
        }

        // 2) delivery/comida (checagem barata por domínio/título, antes da IA)
        if (isBlockedCategory(hit.domain, page.title)) {
          drop(hit.pageUrl, 'delivery-comida');
          continue;
        }

        // 3) precisa parecer página de vendas (heurística barata, antes da IA)
        if (!looksLikeSalesPage({ hasCheckout: page.hasCheckout, hasPrice: page.hasPrice, textLen: page.text.length })) {
          drop(hit.pageUrl, 'nao-e-pagina-de-vendas');
          continue;
        }

        // 4) raio-x + classificação pela IA
        const xray = await extractXray({ pageText: page.text, url: hit.pageUrl, title: hit.title });

        if (!xray.isSalesPage) {
          drop(hit.pageUrl, 'ia-nao-e-pagina-de-vendas');
          continue;
        }
        if (isBlockedCategory(xray.category, xray.niche, hit.title)) {
          drop(hit.pageUrl, 'delivery-comida-ia');
          continue;
        }

        // 5) sinal de tráfego (pixels de anúncio + circulação no urlscan)
        const activity = await getDomainActivity(hit.domain);
        const traffic = computeTraffic({
          pixels: page.pixels,
          domainScanCount: activity.scanCount,
          lastSeen: activity.lastSeen,
        });
        if (!traffic.hasTraffic) {
          drop(hit.pageUrl, 'sem-trafego');
          continue;
        }

        // 6) sinais e score
        const firstSeen = activity.firstSeen ? new Date(activity.firstSeen) : null;
        const lastSeen = activity.lastSeen ? new Date(activity.lastSeen) : hit.time ? new Date(hit.time) : new Date();
        const daysRunning = firstSeen
          ? Math.max(0, Math.round((lastSeen.getTime() - firstSeen.getTime()) / 86400000))
          : 0;

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
        saved++;
      } catch (err) {
        drop(hit.pageUrl, `erro: ${(err as Error).message}`);
      }
    }

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: { status: 'done', foundCount: found, savedCount: saved, discardedCount: discarded, finishedAt: new Date() },
    });
    return { ok: true, found, saved, discarded };
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'error',
        foundCount: found,
        savedCount: saved,
        discardedCount: discarded,
        error: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}
