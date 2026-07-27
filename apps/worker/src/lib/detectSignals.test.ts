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
