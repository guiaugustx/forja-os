import { describe, it, expect } from 'vitest';
import { aggregateHits, type RawHit } from './aggregate';

const hit = (over: Partial<RawHit>): RawHit => ({
  uuid: 'u1',
  pageUrl: 'https://metodoxyz.com.br/vsl',
  pageDomain: 'metodoxyz.com.br',
  title: 'Método X',
  time: '2026-07-01T10:00:00Z',
  referer: null,
  ...over,
});

describe('aggregateHits — fonte de recurso', () => {
  it('agrupa hits do mesmo domínio e conta a circulação', () => {
    const out = aggregateHits(
      [
        hit({ uuid: 'a', time: '2026-07-01T10:00:00Z' }),
        hit({ uuid: 'b', time: '2026-07-10T10:00:00Z', pageUrl: 'https://metodoxyz.com.br/lp' }),
        hit({ uuid: 'c', time: '2026-06-01T10:00:00Z' }),
      ],
      'resource',
    );
    expect(out).toHaveLength(1);
    expect(out[0].hitCount).toBe(3);
    expect(out[0].firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
    expect(out[0].lastSeenAt).toBe('2026-07-10T10:00:00.000Z');
  });

  it('deriva daysRunning da distância entre o primeiro e o último hit', () => {
    const out = aggregateHits(
      [
        hit({ time: '2026-06-01T00:00:00Z' }),
        hit({ uuid: 'b', time: '2026-07-01T00:00:00Z' }),
      ],
      'resource',
    );
    expect(out[0].daysRunning).toBe(30);
  });

  it('separa domínios diferentes', () => {
    const out = aggregateHits(
      [hit({}), hit({ uuid: 'b', pageDomain: 'outro.com', pageUrl: 'https://outro.com/x' })],
      'resource',
    );
    expect(out).toHaveLength(2);
  });

  it('monta a URL do screenshot a partir do uuid do primeiro hit', () => {
    const out = aggregateHits([hit({ uuid: 'abc' })], 'resource');
    expect(out[0].screenshotUrl).toBe('https://urlscan.io/screenshots/abc.png');
  });

  it('guarda o primeiro referer não nulo encontrado', () => {
    const out = aggregateHits(
      [hit({}), hit({ uuid: 'b', referer: 'https://origem.com/lp' })],
      'resource',
    );
    expect(out[0].referer).toBe('https://origem.com/lp');
  });

  it('ordena por circulação decrescente', () => {
    const out = aggregateHits(
      [
        hit({ pageDomain: 'pouco.com', pageUrl: 'https://pouco.com/a' }),
        hit({ uuid: 'b', pageDomain: 'muito.com', pageUrl: 'https://muito.com/a' }),
        hit({ uuid: 'c', pageDomain: 'muito.com', pageUrl: 'https://muito.com/b' }),
      ],
      'resource',
    );
    expect(out[0].domain).toBe('muito.com');
  });
});

describe('aggregateHits — fonte de checkout', () => {
  it('não colapsa produtos diferentes do mesmo gateway', () => {
    const out = aggregateHits(
      [
        hit({ pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-a' }),
        hit({ uuid: 'b', pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-b' }),
        hit({ uuid: 'c', pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-a?utm=1' }),
      ],
      'checkout',
    );
    expect(out).toHaveLength(2);
    const a = out.find((c) => c.dedupeKey.endsWith('produto-a'))!;
    expect(a.hitCount).toBe(2);
  });
});

describe('aggregateHits — bordas', () => {
  it('tolera hits sem data', () => {
    const out = aggregateHits([hit({ time: null })], 'resource');
    expect(out[0].firstSeenAt).toBeNull();
    expect(out[0].daysRunning).toBe(0);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(aggregateHits([], 'resource')).toEqual([]);
  });
});
