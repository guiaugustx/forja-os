import { describe, it, expect } from 'vitest';
import { detectSignals } from './detectSignals';

describe('detectSignals', () => {
  it('detecta pixels pelas requisições do scan (forma real do lists.domains)', () => {
    const s = detectSignals(
      ['connect.facebook.net', 'analytics.tiktok.com', 'fonts.gstatic.com'],
      [],
      'sales-page',
    );
    expect(s.pixels.sort()).toEqual(['facebook', 'tiktok']);
  });

  it('subdomínio arbitrário casa por sufixo com fronteira de ponto', () => {
    const s = detectSignals(['www.googletagmanager.com', 'analytics-ipv6.tiktokw.us'], [], 'sales-page');
    expect(s.pixels.sort()).toEqual(['google', 'tiktok']);
  });

  it('substring sem fronteira NÃO casa (notfacebook.com)', () => {
    const s = detectSignals(['notfacebook.com', 'meufacebook.com.br'], [], 'sales-page');
    expect(s.pixels).toEqual([]);
  });

  it('utmify vai para trackers, nunca para pixels', () => {
    const s = detectSignals(['cdn.utmify.com.br', 'tracking.utmify.com.br'], [], 'sales-page');
    expect(s.trackers).toEqual(['utmify']);
    expect(s.pixels).toEqual([]);
  });

  it('players de VSL detectados', () => {
    const s = detectSignals(['cdn.converteai.net', 'b-vz-123.tv.pandavideo.com.br'], [], 'sales-page');
    expect(s.players.sort()).toEqual(['converteai', 'pandavideo']);
  });

  it('checkout só conta em linkDomains — gateway em domains é ignorado', () => {
    const s = detectSignals(['pay.kiwify.com.br'], ['pay.cakto.com.br'], 'sales-page');
    expect(s.linkedCheckouts).toEqual(['cakto']);
  });

  it('plataformas repetidas deduplicam', () => {
    const s = detectSignals(['connect.facebook.net', 'facebook.com', 'www.facebook.com'], [], 'sales-page');
    expect(s.pixels).toEqual(['facebook']);
  });

  it('propaga a origem', () => {
    expect(detectSignals([], [], 'checkout').origin).toBe('checkout');
  });
});

describe('detectSignals — loja/marketplace (categoria fora do escopo)', () => {
  it('CDN de Shopify/Nuvemshop/VTEX em domains → storefronts', () => {
    const s = detectSignals(
      ['cdn.shopify.com', 'd2r9epyceweg5n.cloudfront.net', 'checkout.nuvemshop.com.br', 'secure.vteximg.com.br'],
      [],
      'sales-page',
    );
    expect(s.storefronts.sort()).toEqual(['nuvemshop', 'shopify', 'vtex']);
  });

  it('marketplace só conta em linkDomains (link, não requisição)', () => {
    const s = detectSignals(
      ['cdn.somewhere.com'],
      ['www.shopee.com.br', 'produto.mercadolivre.com.br'],
      'sales-page',
    );
    expect(s.marketplaces.sort()).toEqual(['mercadolivre', 'shopee']);
    // marketplace em domains (não link) NÃO conta como marketplace
    const s2 = detectSignals(['www.shopee.com.br'], [], 'sales-page');
    expect(s2.marketplaces).toEqual([]);
  });

  it('wix NÃO é storefront (site-builder genérico — evita falso positivo)', () => {
    const s = detectSignals(['static.parastorage.com', 'www.wix.com', 'meusite.wixsite.com'], [], 'sales-page');
    expect(s.storefronts).toEqual([]);
  });

  it('infoproduto real (cakto + pixel, sem loja) → storefronts/marketplaces vazios', () => {
    const s = detectSignals(
      ['connect.facebook.net', 'cdn.utmify.com.br'],
      ['pay.cakto.com.br'],
      'sales-page',
    );
    expect(s.storefronts).toEqual([]);
    expect(s.marketplaces).toEqual([]);
    expect(s.pixels).toEqual(['facebook']);
  });

  it('subtractSelfSignals preserva storefronts/marketplaces (não são tautológicos)', async () => {
    const { selfSignalsFromQuery, subtractSelfSignals } = await import('./detectSignals');
    const detected = detectSignals(['cdn.shopify.com', 'connect.facebook.net'], ['www.shopee.com.br'], 'sales-page');
    const clean = subtractSelfSignals(detected, selfSignalsFromQuery('domain:cdn.utmify.com.br'));
    expect(clean.storefronts).toEqual(['shopify']);
    expect(clean.marketplaces).toEqual(['shopee']);
  });
});

describe('selfSignalsFromQuery / subtractSelfSignals — tautologia da fonte', () => {
  it('fonte utmify exclui o tracker utmify; converteai exclui o player', async () => {
    const { selfSignalsFromQuery, subtractSelfSignals } = await import('./detectSignals');
    expect(selfSignalsFromQuery('domain:cdn.utmify.com.br').trackers).toEqual(['utmify']);
    expect(selfSignalsFromQuery('domain:cdn.converteai.net').players).toEqual(['converteai']);
    expect(selfSignalsFromQuery('page.domain:pay.cakto.com.br').trackers).toEqual([]);

    const detected = detectSignals(
      ['tracking.utmify.com.br', 'connect.facebook.net'],
      [],
      'sales-page',
    );
    const clean = subtractSelfSignals(detected, selfSignalsFromQuery('domain:cdn.utmify.com.br'));
    expect(clean.trackers).toEqual([]); // tautológico removido
    expect(clean.pixels).toEqual(['facebook']); // evidência real preservada
  });

  it('query invertida (AND NOT page.domain) também exclui', async () => {
    const { selfSignalsFromQuery } = await import('./detectSignals');
    const self = selfSignalsFromQuery('domain:pay.hotmart.com AND NOT page.domain:pay.hotmart.com');
    expect(self.trackers).toEqual([]);
    expect(self.pixels).toEqual([]);
  });
});
