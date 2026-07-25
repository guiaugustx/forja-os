import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { searchPage } from '../adapters/urlscan';
import { aggregateHits, type RawHit } from '../lib/aggregate';
import { prefilter } from '../lib/prefilter';
import type { HarvestKind } from '../lib/dedupeKey';

export interface HarvestJobData {
  runId: string;
  sourceId: string;
}

interface HarvestEvent {
  key: string;
  ok: boolean;
  reason?: string;
}

// Trava de segurança: até 20 páginas de 100 por rodada. O cursor persiste, então
// a rodada seguinte continua daqui — não é um teto de cobertura, é um teto de
// duração para que o botão dê retorno em tempo humano.
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

export async function harvest(job: Job<HarvestJobData>) {
  const { runId, sourceId } = job.data;
  const source = await prisma.harvestSource.findUniqueOrThrow({ where: { id: sourceId } });

  let rawHits = 0;
  let newCandidates = 0;
  let autoDiscarded = 0;
  let queuedForTriage = 0;
  const events: HarvestEvent[] = [];

  const progress = (stage: string) =>
    prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        stage,
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
      },
    });

  let cursor = source.cursor;
  let partial = false;
  let partialError: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      await progress(`🔎 Varrendo ${source.name} — página ${page + 1}…`);

      let result;
      try {
        result = await searchPage({ query: source.query, cursor, size: PAGE_SIZE });
      } catch (err) {
        // Rate limit ou instabilidade: encerra a rodada com o que já tem. O cursor
        // salvo abaixo garante que nada se perde — a próxima rodada continua daqui.
        partial = true;
        partialError = (err as Error).message;
        break;
      }

      if (result.hits.length === 0 && result.pageSize === 0) break;
      rawHits += result.pageSize;

      await ingestPage(result.hits, source.kind as HarvestKind, source, runId, {
        onNew: () => newCandidates++,
        onDiscard: (key, reason) => {
          autoDiscarded++;
          events.unshift({ key, ok: false, reason });
          if (events.length > 24) events.length = 24;
        },
        onQueue: (key) => {
          queuedForTriage++;
          events.unshift({ key, ok: true });
          if (events.length > 24) events.length = 24;
        },
      });

      cursor = result.nextCursor;
      if (!cursor || result.pageSize < PAGE_SIZE) break;
    }

    await prisma.harvestSource.update({
      where: { id: sourceId },
      data: { cursor, lastRunAt: new Date() },
    });

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: partial ? 'partial' : 'done',
        stage: partial
          ? `Parcial — ${queuedForTriage} na fila (${partialError})`
          : `Concluído — ${queuedForTriage} na fila, ${autoDiscarded} filtrados`,
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
        error: partialError,
        finishedAt: new Date(),
      },
    });

    return { rawHits, newCandidates, autoDiscarded, queuedForTriage };
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'error',
        stage: 'Falha na colheita',
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        error: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

// Grava os candidatos de uma página. `skipDuplicates` no createMany é o que faz
// o "nunca repete" ser garantia do banco: uma chave já triada simplesmente não
// volta, sem precisar consultar o pool inteiro antes.
async function ingestPage(
  hits: RawHit[],
  kind: HarvestKind,
  source: { id: string; minHitCount: number; maxAgeDays: number },
  runId: string,
  cb: {
    onNew: () => void;
    onDiscard: (key: string, reason: string) => void;
    onQueue: (key: string) => void;
  },
) {
  const candidates = aggregateHits(hits, kind);
  if (candidates.length === 0) return;

  const keys = candidates.map((c) => c.dedupeKey);
  const existing = await prisma.candidate.findMany({
    where: { dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  });
  const known = new Set(existing.map((e) => e.dedupeKey));

  const rows: Prisma.CandidateCreateManyInput[] = [];

  for (const c of candidates) {
    if (known.has(c.dedupeKey)) continue;
    cb.onNew();

    const verdict = prefilter(c, {
      minHitCount: source.minHitCount,
      maxAgeDays: source.maxAgeDays,
    });

    if (verdict.ok) cb.onQueue(c.dedupeKey);
    else cb.onDiscard(c.dedupeKey, verdict.reason);

    rows.push({
      sourceId: source.id,
      dedupeKey: c.dedupeKey,
      url: c.url,
      domain: c.domain,
      title: c.title,
      screenshotUrl: c.screenshotUrl,
      referer: c.referer,
      hitCount: c.hitCount,
      firstSeenAt: c.firstSeenAt ? new Date(c.firstSeenAt) : null,
      lastSeenAt: c.lastSeenAt ? new Date(c.lastSeenAt) : null,
      daysRunning: c.daysRunning,
      status: verdict.ok ? 'pending' : 'discarded_auto',
      discardReason: verdict.ok ? null : verdict.reason,
      firstRunId: runId,
    });
  }

  if (rows.length > 0) {
    await prisma.candidate.createMany({ data: rows, skipDuplicates: true });
  }
}
