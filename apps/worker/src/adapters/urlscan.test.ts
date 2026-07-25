import { describe, it, expect } from 'vitest';
import { parseSearchResponse } from './urlscan';

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
