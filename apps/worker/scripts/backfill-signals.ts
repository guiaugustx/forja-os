/**
 * Backfill de sinais de escala no backlog de triagem (candidatos PENDING).
 *
 * Fase 1 (grátis): aplica a blocklist de golpe/phishing — a MESMA função do
 * prefilter, para paridade garantida — e descarta com razão 'golpe-phishing'.
 * Fase 2 (retrieve, cota 10k/dia): mede pixels/trackers/players de cada
 * pendente sem sinal, calcula o score e aplica a política de descarte
 * (zero sinal medido → 'sem-sinal-trafego'; veredito do urlscan →
 * 'malicioso-urlscan'). Tudo reversível pela aba "descartados pela máquina".
 *
 * Resumível por construção: a fila é `signalScore IS NULL AND signals IS NULL`
 * (o marcador de erro do 404 tira o scan expirado do retry). Ordena por
 * hitCount desc — se o orçamento acabar, os mais quentes já foram medidos.
 *
 * Uso: pnpm --filter @forja/worker backfill:signals -- [--budget 9000]
 *      [--sample 500] [--throttle-ms 500] [--dry-run] [--skip-scam]
 *
 * Modos especiais (exclusivos):
 *   --recompute         recalcula score/tags a partir do JSON gravado (sem rede)
 *   --recheck-category  re-retrieve dos já medidos SEM httpStatus, para aplicar
 *                       as regras de categoria novas (loja/página morta)
 */
import { prisma, Prisma } from '@forja/db';
import { isScamCategory } from '../src/lib/filters';
import { runSignalPass, type SignalPassRow } from '../src/jobs/signalPass';
import {
  selfSignalsFromQuery,
  subtractSelfSignals,
  type DetectedSignals,
} from '../src/lib/detectSignals';
import { scaleSignalScore, hasZeroSignal } from '../src/lib/scaleSignalScore';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function scamPass(dryRun: boolean): Promise<number> {
  // Em JS (não SQL) para usar exatamente a mesma função do prefilter.
  const pend = await prisma.candidate.findMany({
    where: { status: 'pending' },
    select: { id: true, domain: true, title: true, productName: true },
  });
  const ids = pend
    .filter((c) => isScamCategory(c.domain, c.title, c.productName))
    .map((c) => c.id);
  if (!dryRun && ids.length > 0) {
    await prisma.candidate.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'discarded_auto', discardReason: 'golpe-phishing' },
    });
  }
  return ids.length;
}

/**
 * Recalcula score/tags/descartes dos candidatos JÁ MEDIDOS a partir do JSON
 * gravado — sem gastar retrieve. Existe para correções de regra (ex.: a
 * subtração do sinal tautológico da fonte entrou depois da primeira amostra).
 */
async function recomputePass(): Promise<void> {
  const medidos = await prisma.candidate.findMany({
    where: { signalScore: { not: null } },
    select: {
      id: true, status: true, discardReason: true, signals: true, hitCount: true,
      daysRunning: true, lastSeenAt: true, domainAgeDays: true,
      source: { select: { query: true } },
    },
  });
  let changed = 0, discarded = 0, undiscarded = 0;
  for (const c of medidos) {
    const raw = c.signals as unknown as (DetectedSignals & { tags?: string[]; measuredAt?: string; httpStatus?: number | null }) | null;
    if (!raw || !Array.isArray(raw.pixels)) continue;
    const clean = subtractSelfSignals(
      { pixels: raw.pixels, trackers: raw.trackers ?? [], players: raw.players ?? [],
        linkedCheckouts: raw.linkedCheckouts ?? [],
        storefronts: raw.storefronts ?? [], marketplaces: raw.marketplaces ?? [],
        origin: raw.origin ?? 'sales-page' } as DetectedSignals,
      selfSignalsFromQuery(c.source.query),
    );
    const { score, tags } = scaleSignalScore({
      signals: clean, hitCount: c.hitCount, daysRunning: c.daysRunning,
      lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null, domainAgeDays: c.domainAgeDays,
    });
    const zero = hasZeroSignal(clean);
    // Política de zero sinal só mexe em quem está pending ou em quem ESTA regra
    // descartou — decisão humana e outras categorias ficam intactas.
    const shouldDiscard = zero && c.status === 'pending';
    const shouldRestore = !zero && c.status === 'discarded_auto' && c.discardReason === 'sem-sinal-trafego';
    if (shouldDiscard) discarded++;
    if (shouldRestore) undiscarded++;
    await prisma.candidate.update({
      where: { id: c.id },
      data: {
        signalScore: score,
        hasAdPixel: clean.pixels.length > 0,
        signals: { ...clean, tags, httpStatus: raw.httpStatus ?? null, measuredAt: raw.measuredAt ?? new Date().toISOString() } as never,
        ...(shouldDiscard ? { status: 'discarded_auto' as const, discardReason: 'sem-sinal-trafego' } : {}),
        ...(shouldRestore ? { status: 'pending' as const, discardReason: null } : {}),
      },
    });
    changed++;
  }
  console.log(`recompute: ${changed} recalculados · ${discarded} novos descartes sem-sinal · ${undiscarded} restaurados`);
}

/**
 * Re-retrieve dos candidatos JÁ MEDIDOS cujo JSON ainda não tem `httpStatus`
 * (foram medidos antes das regras de categoria loja/página-morta). Reaplica
 * TODAS as regras via runSignalPass, gravando storefronts/marketplaces/
 * httpStatus. Barato (<900 itens na cota de 10k/dia) e resumível: quem já
 * ganhou httpStatus sai da fila. O fluxo normal (não-medidos) já nasce com as
 * regras — este modo existe só para o backlog já medido.
 */
async function recheckCategoryPass(budget: { remaining: number; throttleMs: number }): Promise<void> {
  const medidos = await prisma.candidate.findMany({
    where: { signalScore: { not: null } },
    orderBy: { hitCount: 'desc' },
    select: {
      id: true, dedupeKey: true, scanUuid: true, screenshotUrl: true, hitCount: true,
      daysRunning: true, lastSeenAt: true, domainAgeDays: true, signals: true,
      source: { select: { kind: true, query: true } },
    },
  });
  const fila = medidos.filter((c) => {
    const s = c.signals as { httpStatus?: unknown } | null;
    return !s || s.httpStatus === undefined; // sem httpStatus → nunca passou pelas regras novas
  });
  console.log(`recheck-category · ${fila.length} já medidos sem httpStatus (de ${medidos.length})`);
  if (fila.length === 0) return;

  const rows: SignalPassRow[] = fila.map((b) => ({
    id: b.id,
    dedupeKey: b.dedupeKey,
    scanUuid: b.scanUuid,
    screenshotUrl: b.screenshotUrl,
    hitCount: b.hitCount,
    daysRunning: b.daysRunning,
    lastSeenAt: b.lastSeenAt,
    domainAgeDays: b.domainAgeDays,
    originKind: b.source.kind === 'checkout' ? 'checkout' : 'sales-page',
    sourceQuery: b.source.query,
  }));

  const out = await runSignalPass(rows, budget);
  console.log(
    `recheck-category · +${out.measured} reavaliados · lojas=${out.discardedStore.length} · ` +
      `fora-do-ar=${out.discardedDead.length} · sem-sinal=${out.discardedZeroSignal.length} · ` +
      `maliciosos=${out.discardedMalicious.length} · scans expirados=${out.notFound} · ` +
      `budget restante ${budget.remaining}`,
  );
  if (out.rateLimited) {
    console.log('  ⚠ limite do urlscan/orçamento atingido — rode de novo depois; é resumível.');
  }
}

async function main() {
  if (has('recompute')) {
    await recomputePass();
    return;
  }

  if (has('recheck-category')) {
    const budget = { remaining: arg('budget', 9000), throttleMs: arg('throttle-ms', 500) };
    console.log(`recheck-category — budget=${budget.remaining} throttle=${budget.throttleMs}ms`);
    await recheckCategoryPass(budget);
    return;
  }

  const budget = { remaining: arg('budget', 9000), throttleMs: arg('throttle-ms', 500) };
  const sample = arg('sample', 0); // 0 = sem limite de amostra
  const batchSize = arg('batch', 200);
  const dryRun = has('dry-run');

  console.log(
    `backfill de sinais — budget=${budget.remaining} sample=${sample || '∞'} throttle=${budget.throttleMs}ms${dryRun ? ' (DRY-RUN)' : ''}`,
  );

  if (!has('skip-scam')) {
    const golpes = await scamPass(dryRun);
    console.log(`fase 1 · golpe/phishing: ${golpes} descartados${dryRun ? ' (simulado)' : ''}`);
  }

  if (dryRun) {
    const fila = await prisma.candidate.count({
      where: { status: 'pending', signalScore: null, signals: { equals: Prisma.DbNull } },
    });
    console.log(`fase 2 · ${fila} pendentes sem sinal (nada medido em dry-run)`);
    return;
  }

  let measured = 0;
  let zero = 0;
  let malicious = 0;
  let notFound = 0;
  let handled = 0;

  for (;;) {
    if (sample > 0 && handled >= sample) break;
    const take = sample > 0 ? Math.min(batchSize, sample - handled) : batchSize;
    const batch = await prisma.candidate.findMany({
      where: {
        status: 'pending',
        signalScore: null,
        signals: { equals: Prisma.DbNull },
      },
      orderBy: { hitCount: 'desc' },
      take,
      select: {
        id: true,
        dedupeKey: true,
        scanUuid: true,
        screenshotUrl: true,
        hitCount: true,
        daysRunning: true,
        lastSeenAt: true,
        domainAgeDays: true,
        source: { select: { kind: true, query: true } },
      },
    });
    if (batch.length === 0) break;
    handled += batch.length;

    const rows: SignalPassRow[] = batch.map((b) => ({
      id: b.id,
      dedupeKey: b.dedupeKey,
      scanUuid: b.scanUuid,
      screenshotUrl: b.screenshotUrl,
      hitCount: b.hitCount,
      daysRunning: b.daysRunning,
      lastSeenAt: b.lastSeenAt,
      domainAgeDays: b.domainAgeDays,
      originKind: b.source.kind === 'checkout' ? 'checkout' : 'sales-page',
      sourceQuery: b.source.query,
    }));

    const out = await runSignalPass(rows, budget);
    measured += out.measured;
    zero += out.discardedZeroSignal.length;
    malicious += out.discardedMalicious.length;
    notFound += out.notFound;

    console.log(
      `  lote: +${out.measured} medidos · ${out.discardedZeroSignal.length} sem sinal · ` +
        `${out.discardedMalicious.length} maliciosos · ${out.notFound} scans expirados · ` +
        `budget restante ${budget.remaining}`,
    );
    if (out.rateLimited) {
      console.log('  ⚠ limite do urlscan/orçamento atingido — rode de novo depois; é resumível.');
      break;
    }
  }

  const comPixel = await prisma.candidate.count({ where: { status: 'pending', hasAdPixel: true } });
  const restantes = await prisma.candidate.count({
    where: { status: 'pending', signalScore: null, signals: { equals: Prisma.DbNull } },
  });
  console.log(
    `\nfase 2 · medidos=${measured} descartados: sem-sinal=${zero} maliciosos=${malicious} · ` +
      `scans expirados=${notFound}\npendentes com pixel agora: ${comPixel} · ainda sem medir: ${restantes}`,
  );
}

main()
  .catch((e) => {
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
