// Decisão pura de como atualizar o sinal de circulação de um candidato já
// conhecido, extraída para ser testável sem tocar no banco.
//
// Um candidato que já está no pool nunca é recriado — a colheita só acumula o
// sinal (hitCount, firstSeenAt, lastSeenAt, daysRunning) nele. status,
// discardReason e triagedAt são propriedade da triagem humana e ficam de fora
// daqui: um candidato já decidido não pode "voltar" à fila só porque a oferta
// circulou de novo.

import type { AggregatedCandidate } from './aggregate';

const DAY_MS = 86_400_000;

export interface KnownCandidateRow {
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface CandidateSignalUpdate {
  hitCountIncrement: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  daysRunning: number;
}

export function mergeCandidateSignal(
  aggregated: AggregatedCandidate,
  known: KnownCandidateRow,
): CandidateSignalUpdate {
  const newFirst = aggregated.firstSeenAt ? new Date(aggregated.firstSeenAt) : null;
  const newLast = aggregated.lastSeenAt ? new Date(aggregated.lastSeenAt) : null;

  // A janela observada só alarga: firstSeenAt recua, lastSeenAt avança. Nunca
  // o contrário — um hit isolado fora de ordem não pode encolher o histórico
  // já registrado.
  const firstSeenAt = earlier(known.firstSeenAt, newFirst);
  const lastSeenAt = later(known.lastSeenAt, newLast);

  const daysRunning =
    firstSeenAt && lastSeenAt
      ? Math.max(0, Math.round((lastSeenAt.getTime() - firstSeenAt.getTime()) / DAY_MS))
      : 0;

  return {
    hitCountIncrement: aggregated.hitCount,
    firstSeenAt,
    lastSeenAt,
    daysRunning,
  };
}

function earlier(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b.getTime() < a.getTime() ? b : a;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b.getTime() > a.getTime() ? b : a;
}
