import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { searchPage } from '../adapters/urlscan';
import { aggregateHits, type RawHit } from '../lib/aggregate';
import { prefilter } from '../lib/prefilter';
import { mergeCandidateSignal } from '../lib/mergeCandidate';
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
  // Só permanece true se o laço se esgotar sem nenhum dos breaks de "acabou de
  // verdade" (página vazia, sem próximo cursor, página curta) ser acionado —
  // ou seja, exatamente o caso de bater no teto de MAX_PAGES com cursor sobrando.
  let brokeEarly = false;

  // Salva o cursor alcançado até aqui. Chamado em todo caminho de saída — sucesso,
  // parcial e exceção — para que uma falha do banco no meio da rodada nunca
  // apague o progresso das páginas já comitadas. Não deixa a própria falha de
  // salvar o cursor derrubar o tratamento de erro de quem chamou.
  const persistCursor = async () => {
    try {
      await prisma.harvestSource.update({
        where: { id: sourceId },
        data: { cursor, lastRunAt: new Date() },
      });
    } catch (cursorErr) {
      console.error(
        `[harvest] falha ao persistir cursor da fonte ${sourceId}, rodada ${runId}:`,
        cursorErr,
      );
    }
  };

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
        brokeEarly = true;
        break;
      }

      if (result.hits.length === 0 && result.pageSize === 0) {
        brokeEarly = true;
        break;
      }
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
      if (!cursor || result.pageSize < PAGE_SIZE) {
        brokeEarly = true;
        break;
      }
    }

    // Teto de duração atingido com cursor ainda de pé: a fonte não se esgotou,
    // só paramos de olhar por hoje. A UI precisa dessa distinção — "done" aqui
    // não é "não há mais nada", é "o botão vai continuar daqui na próxima vez".
    const cappedWithMore = !brokeEarly && !!cursor;

    await persistCursor();

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: partial ? 'partial' : 'done',
        stage: partial
          ? `Parcial — ${queuedForTriage} na fila (${partialError})`
          : cappedWithMore
            ? `Concluído — ${queuedForTriage} na fila, ${autoDiscarded} filtrados (teto de ${MAX_PAGES} páginas atingido, ainda há mais para colher — a próxima rodada continua daqui)`
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
    // O cursor tem que ser salvo mesmo quando a rodada termina em exceção —
    // é o único jeito de a próxima rodada não repetir o trabalho já comitado.
    await persistCursor();

    try {
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
    } catch (updateErr) {
      // Se o próprio fechamento da rodada falhar (ex.: o banco que já causou o
      // erro original também derruba este update), quem chamou precisa ver a
      // causa raiz — não o erro secundário de tentar registrar a primeira.
      console.error(
        `[harvest] falha ao registrar erro da rodada ${runId} (causa raiz abaixo):`,
        updateErr,
      );
    }
    throw err;
  }
}

// Grava os candidatos de uma página. `skipDuplicates` no createMany é o que faz
// o "nunca repete" ser garantia do banco para os inéditos: uma chave já triada
// simplesmente não volta, sem precisar consultar o pool inteiro antes.
//
// Candidatos já conhecidos não são recriados nem substituídos: só têm o sinal
// de circulação (hitCount/firstSeenAt/lastSeenAt/daysRunning) acumulado, porque
// hitCount é a chave de ordenação da fila de triagem e não pode congelar no
// valor da primeira página em que a oferta apareceu.
export async function ingestPage(
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
    select: { id: true, dedupeKey: true, firstSeenAt: true, lastSeenAt: true },
  });
  const knownByKey = new Map(existing.map((e) => [e.dedupeKey, e]));

  const rows: Prisma.CandidateCreateManyInput[] = [];

  for (const c of candidates) {
    const known = knownByKey.get(c.dedupeKey);
    if (known) {
      // Só o sinal de circulação muda. status/discardReason/triagedAt ficam de
      // fora do update de propósito: são propriedade da triagem humana, e um
      // candidato já decidido não pode voltar a "pending" só porque a oferta
      // circulou de novo nesta rodada. Também não conta em onNew/onQueue/onDiscard
      // — esses contadores são "candidatos inéditos nesta rodada".
      const merge = mergeCandidateSignal(c, known);
      await prisma.candidate.update({
        where: { id: known.id },
        data: {
          hitCount: { increment: merge.hitCountIncrement },
          firstSeenAt: merge.firstSeenAt,
          lastSeenAt: merge.lastSeenAt,
          daysRunning: merge.daysRunning,
        },
      });
      continue;
    }

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
      productName: c.productName,
      priceCents: c.priceCents,
      gateway: c.gateway,
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
