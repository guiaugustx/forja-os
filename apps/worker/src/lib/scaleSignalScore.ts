// Score de evidência de escala (0–100) de um candidato, calculado na colheita.
//
// "Volume de tráfego" direto não é mensurável de graça; o que É mensurável são
// três proxies, e é isso que o score combina:
//   1. EVIDÊNCIA DE INVESTIMENTO — pixels de anúncio, tracker de atribuição,
//      player de VSL. Ninguém instala atribuição sem gastar em tráfego.
//   2. VELOCIDADE DE ATENÇÃO — scans/dia no urlscan (páginas com tráfego são
//      mais escaneadas por verificadores, extensões e curiosos).
//   3. PERSISTÊNCIA — oferta que segue viva há semanas foi validada por quem
//      paga a conta dela.
//
// O score ORDENA a triagem; o único descarte ligado a ele é o de zero sinal
// MEDIDO (decisão de produto — ver signalPass). Pesos calibráveis: mexa na
// tabela abaixo, não em código espalhado.

import type { DetectedSignals, PixelPlatform } from './detectSignals';

export type SignalTag = 'escalando-agora' | 'comprovada' | 'multi-canal';

export interface ScaleSignalInput {
  // Sinais MEDIDOS. Quem não mediu (retrieve falhou/404) nem chama esta
  // função — score null significa "não medido", e nunca vira 0.
  signals: DetectedSignals;
  hitCount: number;
  daysRunning: number;
  lastSeenAt: string | null;
  domainAgeDays: number | null;
}

// ── Tabela de pesos ──────────────────────────────────────────────────────
// Meta e TikTok dominam a escala de infoproduto BR → peso cheio. Google vale
// pouco: GTM/GA são onipresentes em qualquer site (falso positivo alto).
// Kwai/Pinterest/Taboola são canais pagos menos comuns = sinal mais específico.
const PIXEL_POINTS: Record<PixelPlatform, number> = {
  facebook: 25,
  tiktok: 25,
  google: 10,
  kwai: 15,
  pinterest: 15,
  taboola: 15,
};
const PIXEL_BLOCK_CAP = 40; // teto do bloco: tag-soup não pode dominar o score
const MULTI_CHANNEL_BONUS = 10; // 2+ plataformas = orçamento real, não teste
const TRACKER_POINTS = 15; // atribuição instalada = dinheiro em jogo
const PLAYER_POINTS = 10; // player de VSL = infra paga de vendas
const CHECKOUT_LINK_POINTS = 5; // confirma página de vendas (não interstitial)
const VELOCITY_MAX = 15; // >=1 scan/dia satura
const PERSISTENCE_MAX = 10; // satura em 60 dias
const STALE_AFTER_DAYS = 30; // último scan velho → sinal vale menos…
const STALE_FACTOR = 0.8; // …mas não zera: fase não descarta
// Pixels vindos de scan de CHECKOUT são sinal parcial (ver detectSignals).
const CHECKOUT_ORIGIN_FACTOR = 0.7;

const DAY_MS = 86_400_000;

export function scaleSignalScore(
  i: ScaleSignalInput,
  now: Date = new Date(),
): { score: number; tags: SignalTag[] } {
  const { signals } = i;

  let pixelBlock = 0;
  for (const p of signals.pixels) pixelBlock += PIXEL_POINTS[p] ?? 0;
  pixelBlock = Math.min(pixelBlock, PIXEL_BLOCK_CAP);
  if (signals.pixels.length >= 2) pixelBlock += MULTI_CHANNEL_BONUS;
  if (signals.origin === 'checkout') pixelBlock *= CHECKOUT_ORIGIN_FACTOR;

  let score = pixelBlock;
  if (signals.trackers.length > 0) score += TRACKER_POINTS;
  if (signals.players.length > 0) score += PLAYER_POINTS;
  if (signals.linkedCheckouts.length > 0) score += CHECKOUT_LINK_POINTS;

  const perDay = i.hitCount / Math.max(i.daysRunning, 1);
  score += Math.min(perDay, 1) * VELOCITY_MAX;
  score += (Math.min(i.daysRunning, 60) / 60) * PERSISTENCE_MAX;

  if (i.lastSeenAt) {
    const ageDays = (now.getTime() - Date.parse(i.lastSeenAt)) / DAY_MS;
    if (ageDays > STALE_AFTER_DAYS) score *= STALE_FACTOR;
  }

  const tags: SignalTag[] = [];
  // A tag da antecipação: domínio jovem que JÁ investe em tráfego. É a oferta
  // que dá para pegar antes de todo mundo.
  if (
    i.domainAgeDays != null &&
    i.domainAgeDays <= 45 &&
    signals.pixels.length > 0 &&
    perDay >= 0.5
  ) {
    tags.push('escalando-agora');
  }
  if (i.daysRunning >= 60 && signals.pixels.length > 0) tags.push('comprovada');
  if (signals.pixels.length >= 2) tags.push('multi-canal');

  return { score: Math.round(Math.max(0, Math.min(100, score))), tags };
}

/**
 * Zero sinal de investimento medido: nenhum pixel, tracker ou player.
 * (Checkout linkado sozinho não salva — prova página de vendas, não tráfego.)
 * Decisão de produto: candidato MEDIDO com zero sinal vai para o descarte
 * automático, reversível pela aba "descartados pela máquina".
 */
export function hasZeroSignal(signals: DetectedSignals): boolean {
  return (
    signals.pixels.length === 0 && signals.trackers.length === 0 && signals.players.length === 0
  );
}
