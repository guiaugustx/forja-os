import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { fetchAndExtract } from '../adapters/salesPage';
import { getDomainActivity } from '../adapters/urlscan';
import { fetchTrend } from '../adapters/trends';
import { computeScore } from '../lib/score';
import { looksLikeSalesPage, computeTraffic, isBlockedCategory } from '../lib/filters';
import { resolveSalesPage } from '../lib/resolveSalesPage';

export interface EnrichJobData {
  offerId: string;
}

function parseGrowth(pct: string | null): number | null {
  if (!pct) return null;
  const n = Number(pct.replace(/[+%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * HTML cru, para a cascata de resolução da página de vendas.
 *
 * Não dá para reusar `fetchAndExtract` aqui: ela devolve o texto do body já
 * limpo, sem `<head>` e sem atributos — exatamente onde vivem og:url, canonical
 * e os href que a cascata procura.
 */
async function fetchRawHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ForjaBot/0.1; +https://forja.local) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Enriquecimento de uma oferta promovida: download + raio-x IA + tráfego + trend
 * + score. É o único lugar do sistema onde se gasta requisição de página e token
 * de LLM — por isso roda em dezenas de itens, não em milhares.
 *
 * Regra que difere do fluxo antigo: nenhum veredito aqui DESCARTA a oferta. O que
 * antes matava o candidato (não é página de vendas, produto físico, sem tráfego)
 * agora vira alerta na fila de Análise, porque a decisão já é humana e o descarte
 * automático a essa altura seria desfazer uma escolha sua.
 */
export async function enrich(job: Job<EnrichJobData>) {
  const { offerId } = job.data;
  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: { candidate: { include: { source: true } } },
  });

  await prisma.offer.update({ where: { id: offerId }, data: { enrichment: 'running' } });
  const alerts: string[] = [];

  try {
    const candidate = offer.candidate;
    const isCheckout = candidate?.source.kind === 'checkout';
    let targetUrl = offer.pageUrl ?? candidate?.url ?? '';

    // Numa fonte de checkout, a URL colhida é o gateway — o raio-x precisa da
    // página de vendas, que a cascata tenta descobrir antes de qualquer download.
    if (isCheckout && candidate) {
      const resolved = await resolveSalesPage(candidate.url, candidate.productName, {
        referer: candidate.referer,
        fetchHtml: fetchRawHtml,
        findInPool: async (name) => {
          const hit = await prisma.candidate.findFirst({
            where: {
              title: { contains: name, mode: 'insensitive' },
              source: { kind: 'resource' },
            },
            select: { url: true },
          });
          return hit?.url ?? null;
        },
      });
      if (resolved) targetUrl = resolved.url;
      else alerts.push('pagina-de-vendas-nao-localizada');
    }

    const page = await fetchAndExtract(targetUrl);
    if (!page.ok) alerts.push('sem-conteudo');

    if (page.ok && !looksLikeSalesPage({
      hasCheckout: page.hasCheckout,
      hasPrice: page.hasPrice,
      textLen: page.text.length,
      pixels: page.pixels.length,
    })) {
      alerts.push('nao-e-pagina-de-vendas');
    }

    const xray = page.ok
      ? await extractXray({ pageText: page.text, url: targetUrl, title: offer.name })
      : null;

    if (xray) {
      if (!xray.isSalesPage && !alerts.includes('nao-e-pagina-de-vendas')) {
        alerts.push('nao-e-pagina-de-vendas');
      }
      if (xray.productType && xray.productType !== 'digital') {
        alerts.push(`produto-${xray.productType}`);
      }
      if (isBlockedCategory(xray.category, xray.niche)) alerts.push('categoria-bloqueada');
    }

    const domain = candidate?.domain ?? offer.advertiser;
    const activity = await getDomainActivity(domain);
    const traffic = computeTraffic({
      pixels: page.pixels,
      domainScanCount: activity.scanCount,
      lastSeen: activity.lastSeen,
    });
    if (!traffic.hasTraffic) alerts.push('sem-trafego');

    const niche = xray?.niche || offer.niche || 'desconhecido';
    const market = xray?.market || offer.market || 'BR';
    const competitionCount = await prisma.offer.count({
      where: { niche, market, id: { not: offerId } },
    });

    const trend = await fetchTrend(niche, market);
    if (trend) {
      const series = trend.series as unknown as Prisma.InputJsonValue;
      await prisma.termTrend.upsert({
        where: { term_market: { term: trend.term, market: trend.market } },
        update: { volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
        create: { term: trend.term, market: trend.market, volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
      });
    }

    const firstSeen = activity.firstSeen ? new Date(activity.firstSeen) : offer.firstSeen;
    const lastSeen = activity.lastSeen ? new Date(activity.lastSeen) : offer.lastSeen;
    const daysRunning =
      firstSeen && lastSeen
        ? Math.max(0, Math.round((lastSeen.getTime() - firstSeen.getTime()) / 86_400_000))
        : offer.daysRunning;

    const score = computeScore({
      trafficScore: traffic.score,
      daysRunning,
      scanCount: activity.scanCount,
      ticketEstCents: xray?.ticketEstCents ?? offer.ticketEstCents,
      competitionCount: competitionCount + 1,
      demandGrowthPct: parseGrowth(trend?.growth90d ?? null),
    });

    await prisma.offer.update({
      where: { id: offerId },
      data: {
        pageUrl: targetUrl || offer.pageUrl,
        market,
        niche,
        ticketEstCents: xray?.ticketEstCents ?? offer.ticketEstCents,
        angle: xray?.angle ?? offer.angle,
        detectedGateway: page.detectedGateway ?? offer.detectedGateway,
        xray: xray ? (xray as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        opportunityScore: score,
        trafficScore: traffic.score,
        daysRunning,
        scanCount: activity.scanCount,
        firstSeen,
        lastSeen,
        alerts: alerts as unknown as Prisma.InputJsonValue,
        enrichment: 'done',
        enrichmentError: null,
      },
    });

    return { ok: true, alerts };
  } catch (err) {
    // Falhar aqui não pode derrubar o que já foi preenchido nem sumir no log —
    // o erro precisa aparecer no card, com botão de tentar de novo.
    await prisma.offer.update({
      where: { id: offerId },
      data: {
        enrichment: 'failed',
        enrichmentError: (err as Error).message.slice(0, 500),
        alerts: alerts as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
