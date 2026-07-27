import { describe, it, expect } from 'vitest';
import { scaleSignalScore, hasZeroSignal } from './scaleSignalScore';
import type { DetectedSignals } from './detectSignals';

const NOW = new Date('2026-07-26T00:00:00Z');

const sig = (over: Partial<DetectedSignals> = {}): DetectedSignals => ({
  pixels: [],
  trackers: [],
  players: [],
  linkedCheckouts: [],
  origin: 'sales-page',
  ...over,
});

const base = {
  hitCount: 10,
  daysRunning: 10,
  lastSeenAt: '2026-07-25T00:00:00Z',
  domainAgeDays: 200,
};

describe('scaleSignalScore', () => {
  it('tudo ligado satura no teto 100', () => {
    const { score } = scaleSignalScore(
      {
        ...base,
        hitCount: 120,
        daysRunning: 90,
        signals: sig({
          pixels: ['facebook', 'tiktok', 'kwai'],
          trackers: ['utmify'],
          players: ['converteai'],
          linkedCheckouts: ['cakto'],
        }),
      },
      NOW,
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('medido sem nada dá score baixo mas NUMÉRICO — 0 é válido e distinto de null', () => {
    const { score } = scaleSignalScore(
      { ...base, hitCount: 1, daysRunning: 0, signals: sig() },
      NOW,
    );
    expect(typeof score).toBe('number');
    expect(score).toBeLessThan(30);
  });

  it('google sozinho vale pouco (GTM/GA são onipresentes)', () => {
    const so = scaleSignalScore({ ...base, signals: sig({ pixels: ['google'] }) }, NOW);
    const fb = scaleSignalScore({ ...base, signals: sig({ pixels: ['facebook'] }) }, NOW);
    expect(so.score).toBeLessThan(fb.score);
  });

  it('multi-canal ganha bônus e a tag', () => {
    const um = scaleSignalScore({ ...base, signals: sig({ pixels: ['facebook'] }) }, NOW);
    const dois = scaleSignalScore(
      { ...base, signals: sig({ pixels: ['facebook', 'tiktok'] }) },
      NOW,
    );
    expect(dois.score).toBeGreaterThan(um.score);
    expect(dois.tags).toContain('multi-canal');
  });

  it('origem checkout reduz o bloco de pixels', () => {
    const pagina = scaleSignalScore({ ...base, signals: sig({ pixels: ['facebook'] }) }, NOW);
    const checkout = scaleSignalScore(
      { ...base, signals: sig({ pixels: ['facebook'], origin: 'checkout' }) },
      NOW,
    );
    expect(checkout.score).toBeLessThan(pagina.score);
  });

  it('sinal velho (>30d) vale menos, mas não zera', () => {
    const fresco = scaleSignalScore({ ...base, signals: sig({ pixels: ['facebook'] }) }, NOW);
    const velho = scaleSignalScore(
      { ...base, lastSeenAt: '2026-05-01T00:00:00Z', signals: sig({ pixels: ['facebook'] }) },
      NOW,
    );
    expect(velho.score).toBeLessThan(fresco.score);
    expect(velho.score).toBeGreaterThan(0);
  });

  it('tag escalando-agora: domínio jovem + pixel + velocidade', () => {
    const { tags } = scaleSignalScore(
      {
        hitCount: 10,
        daysRunning: 10,
        lastSeenAt: '2026-07-25T00:00:00Z',
        domainAgeDays: 20,
        signals: sig({ pixels: ['tiktok'] }),
      },
      NOW,
    );
    expect(tags).toContain('escalando-agora');
  });

  it('domínio jovem SEM pixel não ganha escalando-agora', () => {
    const { tags } = scaleSignalScore(
      { ...base, domainAgeDays: 20, signals: sig() },
      NOW,
    );
    expect(tags).not.toContain('escalando-agora');
  });

  it('tag comprovada: persistência de 60d+ com pixel', () => {
    const { tags } = scaleSignalScore(
      { ...base, daysRunning: 75, signals: sig({ pixels: ['facebook'] }) },
      NOW,
    );
    expect(tags).toContain('comprovada');
  });
});

describe('hasZeroSignal', () => {
  it('zero em pixels/trackers/players = sem sinal', () => {
    expect(hasZeroSignal(sig())).toBe(true);
  });
  it('checkout linkado sozinho NÃO salva (prova página de vendas, não tráfego)', () => {
    expect(hasZeroSignal(sig({ linkedCheckouts: ['kiwify'] }))).toBe(true);
  });
  it('qualquer pixel/tracker/player salva', () => {
    expect(hasZeroSignal(sig({ pixels: ['facebook'] }))).toBe(false);
    expect(hasZeroSignal(sig({ trackers: ['utmify'] }))).toBe(false);
    expect(hasZeroSignal(sig({ players: ['vturb'] }))).toBe(false);
  });
});
