import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { fetchAndExtract } from '../adapters/salesPage';
import { getDomainActivity } from '../adapters/urlscan';
import { fetchTrend } from '../adapters/trends';
import { computeScore } from '../lib/score';
import { looksLikeSalesPage, computeTraffic, isBlockedCategory } from '../lib/filters';
import { resolveSalesPage } from '../lib/resolveSalesPage';
import { parseGrowth } from '../lib/growth';

export interface EnrichJobData {
  offerId: string;
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
    // Se a cascata desiste, `targetUrl` continua apontando pro gateway — sinalizado
    // abaixo para não gastar token de LLM nele (Correção 4).
    let salesPageMissing = false;
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
      else {
        alerts.push('pagina-de-vendas-nao-localizada');
        salesPageMissing = true;
      }
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

    // Correção 4: numa fonte de checkout sem página de vendas resolvida,
    // `targetUrl` é o próprio gateway — mandar isso pro raio-x gastaria o token de
    // LLM que este job existe para racionar, produzindo um raio-x previsivelmente
    // inútil. O alerta `pagina-de-vendas-nao-localizada` já avisa o humano; o
    // resto do enriquecimento (tráfego, atividade, score) segue normalmente.
    const xray = page.ok && !salesPageMissing
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

    // Correção 1: `getDomainActivity` devolve exatamente essa forma vazia
    // (scanCount 0, sem firstSeen/lastSeen) tanto quando o domínio realmente não
    // tem histórico quanto quando o urlscan respondeu !ok — ela não lança, então
    // não dá pra distinguir os dois casos pelo valor sozinho. Combinado com a
    // página não tendo baixado (sem pixels pra ler), nenhum dos dois insumos do
    // tráfego é real: gravar zero aqui não seria medir, seria apagar um dossiê
    // bom por causa de uma coleta ruim. Preservamos o valor anterior da oferta.
    const activityIsEmpty = activity.scanCount === 0 && !activity.firstSeen && !activity.lastSeen;
    const collectionFailed = !page.ok && activityIsEmpty;
    const trafficScore = collectionFailed ? (offer.trafficScore ?? traffic.score) : traffic.score;
    const scanCount = collectionFailed ? (offer.scanCount ?? activity.scanCount) : activity.scanCount;

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

    // Correção 3: no schema do raio-x `ticketEstCents` é nonnegative, então `0` é
    // um valor válido e `??` não cai no fallback — uma página sem preço visível
    // gravaria 0 por cima de um ticket bom já conhecido. Tratamos 0 como ausência.
    const ticketEstCents = xray?.ticketEstCents ? xray.ticketEstCents : offer.ticketEstCents;

    const score = computeScore({
      trafficScore,
      daysRunning,
      scanCount,
      ticketEstCents,
      competitionCount: competitionCount + 1,
      demandGrowthPct: parseGrowth(trend?.growth90d ?? null),
    });

    const baseData = {
      market,
      niche,
      ticketEstCents,
      angle: xray?.angle ?? offer.angle,
      detectedGateway: page.detectedGateway ?? offer.detectedGateway,
      // Correção 1: sem raio-x novo (página não baixou), preservar o que já está
      // gravado é melhor que apagar um dossiê bom com `Prisma.DbNull`.
      xray: xray
        ? (xray as unknown as Prisma.InputJsonValue)
        : ((offer.xray as Prisma.InputJsonValue | null) ?? Prisma.DbNull),
      opportunityScore: score,
      trafficScore,
      daysRunning,
      scanCount,
      firstSeen,
      lastSeen,
      alerts: alerts as unknown as Prisma.InputJsonValue,
      enrichment: 'done' as const,
      enrichmentError: null,
    };

    try {
      await prisma.offer.update({
        where: { id: offerId },
        data: { ...baseData, pageUrl: targetUrl || offer.pageUrl },
      });
    } catch (err) {
      // Correção 2: numa fonte de checkout, `targetUrl` é a página de vendas que a
      // cascata resolveu — `extractBackLink` pega o primeiro link plausível, que
      // costuma ser a home do produtor, e dois checkouts do mesmo produtor
      // convergem pra mesma URL. O segundo `update` estoura P2002 no índice
      // @@unique([source, pageUrl]). Isso não é uma falha do enriquecimento (o
      // raio-x, tráfego e score são bons) — é uma colisão de identidade que o
      // humano resolve olhando o chip. Sem esse catch, toda retentativa falharia
      // igual, porque a cascata sempre resolve a mesma URL colidente.
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        JSON.stringify((err.meta as { target?: unknown } | undefined)?.target ?? '').includes('pageUrl');
      if (!isUniqueViolation) throw err;

      alerts.push('pagina-de-vendas-duplicada');
      await prisma.offer.update({
        where: { id: offerId },
        data: {
          ...baseData,
          // Mantém a pageUrl original da oferta (a do checkout), que não colide.
          alerts: alerts as unknown as Prisma.InputJsonValue,
        },
      });
    }

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
