import { describe, it, expect } from 'vitest';
import { normalizeUrl, buildDedupeKey } from './dedupeKey';

describe('normalizeUrl', () => {
  it('remove query, hash e barra final, e baixa o host', () => {
    expect(normalizeUrl('https://Pay.Cakto.com.br/abc123/?utm_source=fb#top')).toBe(
      'https://pay.cakto.com.br/abc123',
    );
  });

  it('preserva a raiz como barra única', () => {
    expect(normalizeUrl('https://metodoxyz.com.br/')).toBe('https://metodoxyz.com.br/');
  });

  it('devolve a entrada quando a URL é inválida', () => {
    expect(normalizeUrl('nao-e-url')).toBe('nao-e-url');
  });
});

describe('buildDedupeKey', () => {
  it('fonte de recurso chaveia pelo domínio da página', () => {
    const key = buildDedupeKey('resource', {
      pageUrl: 'https://metodoxyz.com.br/vsl?utm=1',
      pageDomain: 'metodoxyz.com.br',
    });
    expect(key).toBe('metodoxyz.com.br');
  });

  it('fonte de checkout chaveia pela URL normalizada, não pelo domínio', () => {
    const a = buildDedupeKey('checkout', {
      pageUrl: 'https://pay.cakto.com.br/produto-a?src=ig',
      pageDomain: 'pay.cakto.com.br',
    });
    const b = buildDedupeKey('checkout', {
      pageUrl: 'https://pay.cakto.com.br/produto-b',
      pageDomain: 'pay.cakto.com.br',
    });
    expect(a).toBe('https://pay.cakto.com.br/produto-a');
    expect(a).not.toBe(b);
  });

  it('normaliza o domínio para minúsculas na fonte de recurso', () => {
    expect(
      buildDedupeKey('resource', { pageUrl: 'https://X.com/a', pageDomain: 'MetodoXYZ.com.br' }),
    ).toBe('metodoxyz.com.br');
  });
});
