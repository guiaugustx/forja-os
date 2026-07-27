// Signal pass: mede os sinais de escala de um lote de candidatos via retrieve
// do urlscan (1 chamada por candidato, cota própria de 10k/dia).
//
// Compartilhado entre o harvest (candidatos novos de cada rodada) e o script
// de backfill (backlog). Regras que não podem quebrar:
//   - Falha de retrieve NUNCA falha a rodada/lote: 429 interrompe o pass e o
//     resto fica sem medir (score null), medível depois.
//   - score null ≠ score 0. Null é "não medido"; 0 é "medido e sem nada".
//   - Descartes daqui são reversíveis pela aba "descartados pela máquina":
//     'malicioso-urlscan' (veredito do próprio urlscan) e 'sem-sinal-trafego'
//     (decisão de produto: medido com zero pixel/tracker/player sai da fila).

import { prisma, Prisma } from '@forja/db';
import { getScanResult, UrlscanRateLimitError } from '../adapters/urlscan';
import { detectSignals, type SignalOrigin } from '../lib/detectSignals';
import { scaleSignalScore, hasZeroSignal } from '../lib/scaleSignalScore';

export interface SignalPassRow {
  id: string;
  dedupeKey: string;
  scanUuid: string | null;
  screenshotUrl: string | null;
  hitCount: number;
  daysRunning: number;
  lastSeenAt: Date | null;
  domainAgeDays: number | null;
  originKind: SignalOrigin;
}

export interface SignalPassBudget {
  remaining: number; // retrieves restantes (mutável — compartilhado entre páginas da rodada)
  throttleMs: number;
}

export interface SignalPassResult {
  measured: number;
  discardedMalicious: string[]; // dedupeKeys — o harvest ajusta contadores com isto
  discardedZeroSignal: string[]; // idem
  notFound: number; // scans expirados (404) — marcados para não re-tentar
  rateLimited: boolean; // true = 429/orçamento interrompeu; o resto ficou null
}

export function budgetFromEnv(): SignalPassBudget {
  return {
    remaining: Number(process.env.SIGNAL_MAX_RETRIEVES_PER_HARVEST ?? 300),
    throttleMs: Number(process.env.SIGNAL_RETRIEVE_THROTTLE_MS ?? 500),
  };
}

/** uuid do candidato: campo próprio, ou resgatado do screenshotUrl (backlog antigo). */
export function extractUuid(row: {
  scanUuid: string | null;
  screenshotUrl: string | null;
}): string | null {
  if (row.scanUuid) return row.scanUuid;
  const m = row.screenshotUrl?.match(/\/screenshots\/([0-9a-f-]{36})\.png$/i);
  return m ? m[1] : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSignalPass(
  rows: SignalPassRow[],
  budget: SignalPassBudget,
): Promise<SignalPassResult> {
  const out: SignalPassResult = {
    measured: 0,
    discardedMalicious: [],
    discardedZeroSignal: [],
    notFound: 0,
    rateLimited: false,
  };

  for (const row of rows) {
    const uuid = extractUuid(row);
    if (!uuid) continue; // sem uuid não há o que medir — fica null

    if (budget.remaining <= 0) {
      out.rateLimited = true;
      break;
    }
    budget.remaining--;

    let result;
    try {
      result = await getScanResult(uuid);
    } catch (err) {
      if (err instanceof UrlscanRateLimitError) {
        out.rateLimited = true;
        break; // para o pass inteiro; nunca propaga
      }
      // Erro transitório num scan específico: não marca nada (re-tentável).
      console.warn(`[signals] retrieve falhou para ${row.dedupeKey}: ${(err as Error).message}`);
      continue;
    }

    if (result === null) {
      // Scan expirado: marca o erro para o backfill não re-tentar para sempre,
      // mas o score continua null — "não medido" é diferente de "medido fraco".
      out.notFound++;
      await prisma.candidate.update({
        where: { id: row.id },
        data: {
          scanUuid: uuid,
          signals: { error: 'result-404', measuredAt: new Date().toISOString() },
        },
      });
      await sleep(budget.throttleMs);
      continue;
    }

    const detected = detectSignals(result.domains, result.linkDomains, row.originKind);
    const domainAgeDays = row.domainAgeDays ?? result.domainAgeDays;

    if (result.malicious) {
      out.discardedMalicious.push(row.dedupeKey);
      await prisma.candidate.update({
        where: { id: row.id },
        data: {
          status: 'discarded_auto',
          discardReason: 'malicioso-urlscan',
          scanUuid: uuid,
          domainAgeDays,
          tlsAgeDays: result.tlsAgeDays,
          hasAdPixel: detected.pixels.length > 0,
          signals: {
            ...detected,
            measuredAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await sleep(budget.throttleMs);
      continue;
    }

    const { score, tags } = scaleSignalScore({
      signals: detected,
      hitCount: row.hitCount,
      daysRunning: row.daysRunning,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      domainAgeDays,
    });

    const zero = hasZeroSignal(detected);
    if (zero) out.discardedZeroSignal.push(row.dedupeKey);

    await prisma.candidate.update({
      where: { id: row.id },
      data: {
        ...(zero ? { status: 'discarded_auto' as const, discardReason: 'sem-sinal-trafego' } : {}),
        scanUuid: uuid,
        domainAgeDays,
        tlsAgeDays: result.tlsAgeDays,
        signalScore: score,
        hasAdPixel: detected.pixels.length > 0,
        signals: {
          ...detected,
          tags,
          measuredAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    out.measured++;
    await sleep(budget.throttleMs);
  }

  return out;
}
