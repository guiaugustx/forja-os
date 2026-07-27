import { describe, it, expect } from 'vitest';
import { prefilter } from './prefilter';
import type { AggregatedCandidate } from './aggregate';

const NOW = new Date('2026-07-24T00:00:00Z');
const RULES = { minHitCount: 1, maxAgeDays: 90 };

const cand = (over: Partial<AggregatedCandidate> = {}): AggregatedCandidate => ({
  dedupeKey: 'metodoxyz.com.br',
  url: 'https://metodoxyz.com.br/vsl',
  domain: 'metodoxyz.com.br',
  title: 'Método X — Emagreça em 21 dias',
  screenshotUrl: null,
  referer: null,
  hitCount: 3,
  firstSeenAt: '2026-06-01T00:00:00Z',
  lastSeenAt: '2026-07-20T00:00:00Z',
  daysRunning: 49,
  ...over,
});

describe('prefilter', () => {
  it('aprova um candidato normal', () => {
    expect(prefilter(cand(), RULES, NOW)).toEqual({ ok: true });
  });

  it('descarta pela blocklist de categoria no título', () => {
    const r = prefilter(cand({ title: 'Pizzaria do Zé — peça pelo delivery' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'delivery-comida' });
  });

  it('descarta pela blocklist de categoria no domínio', () => {
    const r = prefilter(cand({ domain: 'hamburgueriacentral.com.br' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'delivery-comida' });
  });

  it('descarta quando a circulação fica abaixo do limiar da fonte', () => {
    const r = prefilter(cand({ hitCount: 1 }), { minHitCount: 2, maxAgeDays: 90 }, NOW);
    expect(r).toEqual({ ok: false, reason: 'sem-circulacao' });
  });

  it('descarta quando o último hit é mais velho que a janela da fonte', () => {
    const r = prefilter(cand({ lastSeenAt: '2026-01-01T00:00:00Z' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'sem-circulacao' });
  });

  it('aprova quando não há data — não inventa motivo de descarte', () => {
    expect(prefilter(cand({ lastSeenAt: null }), RULES, NOW)).toEqual({ ok: true });
  });

  it('com os limiares padrão, um candidato recente de hit único passa', () => {
    const r = prefilter(cand({ hitCount: 1, lastSeenAt: '2026-07-23T00:00:00Z' }), RULES, NOW);
    expect(r).toEqual({ ok: true });
  });
});

describe('prefilter — golpe/phishing', () => {
  const NOW2 = new Date('2026-07-24T00:00:00Z');
  const R = { minHitCount: 1, maxAgeDays: 90 };
  const c = (title: string, domain = 'exemplo.com') => ({
    dedupeKey: domain, url: `https://${domain}/x`, domain, title,
    screenshotUrl: null, referer: null, hitCount: 3,
    firstSeenAt: '2026-07-01T00:00:00Z', lastSeenAt: '2026-07-20T00:00:00Z',
    daysRunning: 19, productName: null, priceCents: null, gateway: null,
    scanUuid: null, domainAgeDays: null, tlsAgeDays: null,
  });

  it('descarta golpe por título composto', () => {
    expect(prefilter(c('Consulta Nacional de CPF – Regularização'), R, NOW2))
      .toEqual({ ok: false, reason: 'golpe-phishing' });
    expect(prefilter(c('Centro de Recarga Free Fire'), R, NOW2))
      .toEqual({ ok: false, reason: 'golpe-phishing' });
    expect(prefilter(c('Leilão Linha Branca - Casas Bahia'), R, NOW2))
      .toEqual({ ok: false, reason: 'golpe-phishing' });
  });

  it('descarta golpe pelo domínio', () => {
    expect(prefilter(c('Concurso Público', 'gov-pf.netlify.app'), R, NOW2))
      .toEqual({ ok: false, reason: 'golpe-phishing' });
  });

  it('oferta legítima que menciona CPF solto passa', () => {
    expect(prefilter(c('Planilha de Controle Financeiro Pessoal'), R, NOW2)).toEqual({ ok: true });
    expect(prefilter(c('Método CPF Blindado de Vendas'), R, NOW2)).toEqual({ ok: true });
  });

  it('golpe vence comida quando os dois batem (razão mais específica primeiro)', () => {
    expect(prefilter(c('Recarga Free Fire do Pizza Lover'), R, NOW2))
      .toEqual({ ok: false, reason: 'golpe-phishing' });
  });
});
