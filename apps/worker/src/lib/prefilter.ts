// Pré-filtro da colheita: só descarta com o que a varredura já devolveu.
//
// Nada aqui pode fazer requisição HTTP. Verificar se o domínio está no ar
// custaria uma requisição por candidato, o que em milhares de itens deixa de
// ser custo zero — página fora do ar é problema do enriquecimento, onde o
// download já acontece.
//
// Todo descarte grava o motivo e aparece na aba "descartados pela máquina",
// para que o filtro não vire caixa-preta.

import { isBlockedCategory } from './filters';
import type { AggregatedCandidate } from './aggregate';

export type PrefilterReason = 'delivery-comida' | 'sem-circulacao';

export interface PrefilterRules {
  minHitCount: number;
  maxAgeDays: number;
}

const DAY_MS = 86_400_000;

export function prefilter(
  c: AggregatedCandidate,
  rules: PrefilterRules,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: PrefilterReason } {
  if (isBlockedCategory(c.domain, c.title)) return { ok: false, reason: 'delivery-comida' };

  if (c.hitCount < rules.minHitCount) return { ok: false, reason: 'sem-circulacao' };

  if (c.lastSeenAt) {
    const ageDays = (now.getTime() - Date.parse(c.lastSeenAt)) / DAY_MS;
    if (ageDays > rules.maxAgeDays) return { ok: false, reason: 'sem-circulacao' };
  }

  return { ok: true };
}
