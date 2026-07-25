import { describe, it, expect, vi } from 'vitest';
import { extractBackLink, resolveSalesPage } from './resolveSalesPage';

describe('extractBackLink', () => {
  it('prefere og:url quando aponta para fora do gateway', () => {
    const html = `<html><head><meta property="og:url" content="https://metodoxyz.com.br/vsl"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br/vsl');
  });

  it('ignora og:url que aponta para o próprio gateway', () => {
    const html = `<html><head><meta property="og:url" content="https://pay.cakto.com.br/abc"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBeNull();
  });

  it('cai para o primeiro link externo quando não há og:url', () => {
    const html = `<html><body>
      <a href="https://pay.cakto.com.br/termos">Termos</a>
      <a href="https://metodoxyz.com.br">Voltar ao site</a>
    </body></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br');
  });

  it('ignora links de plataforma e redes sociais', () => {
    const html = `<html><body>
      <a href="https://www.instagram.com/loja">Instagram</a>
      <a href="https://cakto.com.br">Cakto</a>
      <a href="https://metodoxyz.com.br">Site</a>
    </body></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br');
  });

  it('devolve null quando não há candidato', () => {
    expect(extractBackLink('<html><body>nada</body></html>', 'pay.cakto.com.br')).toBeNull();
  });
});

describe('extractBackLink — falso positivo de substring na lista de bloqueio', () => {
  it('não descarta netflix.com mesmo terminando nas letras de x.com', () => {
    const html = `<html><head><meta property="og:url" content="https://netflix.com/oferta"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://netflix.com/oferta');
  });

  it('não descarta stripedshirts.com.br mesmo contendo a marca stripe como parte do rótulo', () => {
    const html = `<html><head><meta property="og:url" content="https://stripedshirts.com.br/oferta"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://stripedshirts.com.br/oferta');
  });

  it('descarta www.instagram.com pelo sufixo de subdomínio', () => {
    const html = `<html><head><meta property="og:url" content="https://www.instagram.com/loja"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBeNull();
  });

  it('descarta instagram.com exato (sem subdomínio)', () => {
    const html = `<html><head><meta property="og:url" content="https://instagram.com/loja"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBeNull();
  });

  it('descarta pay.cakto.com.br pela marca de gateway no rótulo do host', () => {
    const html = `<html><head><meta property="og:url" content="https://pay.cakto.com.br/outra-oferta"></head></html>`;
    expect(extractBackLink(html, 'checkout.cakto.com.br')).toBeNull();
  });

  it('continua descartando o host igual ao domínio do próprio checkout', () => {
    const html = `<html><head><meta property="og:url" content="https://pay.cakto.com.br/outra-oferta"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBeNull();
  });
});

describe('resolveSalesPage', () => {
  const noop = {
    fetchHtml: async () => null,
    findInPool: async () => null,
  };

  it('degrau 1 — usa o referer e não gasta requisição', async () => {
    const fetchHtml = vi.fn(async () => null);
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      ...noop,
      referer: 'https://metodoxyz.com.br/vsl',
      fetchHtml,
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br/vsl', via: 'referer' });
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('ignora referer que aponta para o próprio gateway', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      ...noop,
      referer: 'https://pay.cakto.com.br/outro',
    });
    expect(r).toBeNull();
  });

  it('degrau 2 — extrai o link de volta do HTML do checkout', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      ...noop,
      referer: null,
      fetchHtml: async () => `<meta property="og:url" content="https://metodoxyz.com.br/vsl">`,
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br/vsl', via: 'backlink' });
  });

  it('degrau 3 — busca no pool pelo nome do produto', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool: async (name) => (name === 'Método X' ? 'https://metodoxyz.com.br' : null),
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br', via: 'pool' });
  });

  it('não busca no pool sem nome de produto', async () => {
    const findInPool = vi.fn(async () => 'https://x.com');
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool,
    });
    expect(r).toBeNull();
    expect(findInPool).not.toHaveBeenCalled();
  });

  it('degrau 4 — devolve null quando toda a cascata falha', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool: async () => null,
    });
    expect(r).toBeNull();
  });
});
