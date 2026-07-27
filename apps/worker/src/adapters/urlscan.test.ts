import { describe, it, expect } from 'vitest';
import { parseSearchResponse, parseScanResult } from './urlscan';

const payload = {
  results: [
    {
      _id: 'aaa',
      sort: [1719000000000, 'aaa'],
      page: { url: 'https://metodoxyz.com.br/vsl', domain: 'metodoxyz.com.br', title: 'Método X' },
      task: { url: 'https://metodoxyz.com.br/vsl', time: '2026-07-01T10:00:00Z', referer: 'https://ig.com' },
    },
    {
      _id: 'bbb',
      sort: [1718000000000, 'bbb'],
      page: { url: 'https://outro.com/lp', domain: 'outro.com' },
      task: { time: '2026-06-20T10:00:00Z' },
    },
  ],
};

describe('parseSearchResponse', () => {
  it('converte resultados em RawHit preservando o referer', () => {
    const { hits } = parseSearchResponse(payload);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      uuid: 'aaa',
      pageUrl: 'https://metodoxyz.com.br/vsl',
      pageDomain: 'metodoxyz.com.br',
      title: 'Método X',
      time: '2026-07-01T10:00:00Z',
      referer: 'https://ig.com',
      domainAgeDays: null,
      tlsAgeDays: null,
    });
  });

  it('usa o domínio como título quando a página não tem um', () => {
    const { hits } = parseSearchResponse(payload);
    expect(hits[1].title).toBe('outro.com');
  });

  it('extrai o cursor do sort do último resultado', () => {
    const { nextCursor } = parseSearchResponse(payload);
    expect(nextCursor).toBe('1718000000000,bbb');
  });

  it('devolve cursor nulo quando não há sort', () => {
    const { nextCursor } = parseSearchResponse({ results: [{ _id: 'x', page: { url: 'https://a.com', domain: 'a.com' } }] });
    expect(nextCursor).toBeNull();
  });

  it('ignora resultados sem url ou sem domínio', () => {
    const { hits } = parseSearchResponse({ results: [{ _id: 'x', page: {} }, { _id: 'y', page: { url: 'https://a.com' } }] });
    expect(hits).toHaveLength(0);
  });

  it('devolve vazio para payload sem results', () => {
    expect(parseSearchResponse({})).toEqual({ hits: [], nextCursor: null, pageSize: 0 });
  });
});

describe('parseSearchResponse — idades do domínio', () => {
  it('prefere domainAgeDays; apex é fallback (lovable/vercel têm apex velho)', () => {
    const { hits } = parseSearchResponse({
      results: [
        { _id: 'a', page: { url: 'https://a.com/x', domain: 'a.com', domainAgeDays: 12, apexDomainAgeDays: 900, tlsAgeDays: 5 } },
        { _id: 'b', page: { url: 'https://b.lovable.app/x', domain: 'b.lovable.app', apexDomainAgeDays: 900 } },
        { _id: 'c', page: { url: 'https://c.com/x', domain: 'c.com' } },
      ],
    });
    expect(hits[0].domainAgeDays).toBe(12);
    expect(hits[0].tlsAgeDays).toBe(5);
    expect(hits[1].domainAgeDays).toBe(900);
    expect(hits[2].domainAgeDays).toBeNull();
    expect(hits[2].tlsAgeDays).toBeNull();
  });

  it('valor lixo vira null', () => {
    const { hits } = parseSearchResponse({
      results: [{ _id: 'a', page: { url: 'https://a.com', domain: 'a.com', domainAgeDays: 'muitos' } }],
    });
    expect(hits[0].domainAgeDays).toBeNull();
  });
});

describe('parseScanResult', () => {
  // Fixture mínima com a FORMA REAL do retrieve (validada ao vivo em 26/07):
  // lists.domains traz os domínios contatados, lists.linkDomains os linkados.
  const fixture = {
    lists: {
      domains: ['analytics.tiktok.com', 'evaluadoroficial.site', 'tracking.utmify.com.br', 'cdn.utmify.com.br', 'fonts.gstatic.com'],
      linkDomains: ['pay.kiwify.com.br'],
    },
    verdicts: { overall: { malicious: false } },
    page: { domainAgeDays: 30, tlsAgeDays: 7 },
  };

  it('extrai domains, linkDomains, veredito e idades', () => {
    const r = parseScanResult(fixture);
    expect(r.domains).toContain('analytics.tiktok.com');
    expect(r.linkDomains).toEqual(['pay.kiwify.com.br']);
    expect(r.malicious).toBe(false);
    expect(r.domainAgeDays).toBe(30);
    expect(r.tlsAgeDays).toBe(7);
  });

  it('malicioso true propaga', () => {
    const r = parseScanResult({ ...fixture, verdicts: { overall: { malicious: true } } });
    expect(r.malicious).toBe(true);
  });

  it('lists/verdicts ausentes → vazios e false, sem lançar', () => {
    const r = parseScanResult({});
    expect(r.domains).toEqual([]);
    expect(r.linkDomains).toEqual([]);
    expect(r.malicious).toBe(false);
    expect(r.domainAgeDays).toBeNull();
    expect(r.httpStatus).toBeNull();
  });

  it('httpStatus lido de page.status (string no JSON do urlscan) → número', () => {
    expect(parseScanResult({ page: { status: '200' } }).httpStatus).toBe(200);
    expect(parseScanResult({ page: { status: '404' } }).httpStatus).toBe(404);
    expect(parseScanResult({ page: { status: 503 } }).httpStatus).toBe(503);
  });

  it('page.status ausente ou vazio → httpStatus null (não medido, nunca 0)', () => {
    expect(parseScanResult({ page: {} }).httpStatus).toBeNull();
    expect(parseScanResult({ page: { status: '' } }).httpStatus).toBeNull();
    expect(parseScanResult({ page: { status: 'aborted' } }).httpStatus).toBeNull();
  });
});
