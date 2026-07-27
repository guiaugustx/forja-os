import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawHit } from '../lib/aggregate';

const findMany = vi.fn();
const update = vi.fn();
const createMany = vi.fn();

const getScanResult = vi.fn();

vi.mock('../adapters/urlscan', () => ({
  searchPage: vi.fn(),
  getScanResult: (...args: unknown[]) => getScanResult(...args),
  parseSearchResponse: vi.fn(),
  parseScanResult: vi.fn(),
  getDomainActivity: vi.fn(),
  getDomText: vi.fn(),
  UrlscanRateLimitError: class UrlscanRateLimitError extends Error {},
}));

vi.mock('@forja/db', () => ({
  prisma: {
    candidate: {
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
      createMany: (...args: unknown[]) => createMany(...args),
    },
  },
  Prisma: {},
}));

// Import depois do mock, para que `harvest.ts` receba o prisma fake.
const { ingestPage } = await import('./harvest');

const hit = (over: Partial<RawHit>): RawHit => ({
  uuid: 'u1',
  pageUrl: 'https://metodoxyz.com.br/vsl',
  pageDomain: 'metodoxyz.com.br',
  title: 'Método X',
  time: '2026-07-10T00:00:00Z',
  referer: null,
  ...over,
});

const source = { id: 'src-1', minHitCount: 1, maxAgeDays: 90 };

function callbacks() {
  const onNew = vi.fn();
  const onDiscard = vi.fn();
  const onQueue = vi.fn();
  const onSignalDiscard = vi.fn();
  return { onNew, onDiscard, onQueue, onSignalDiscard };
}

// Orçamento farto e sem throttle: os testes daqui não medem cota, medem lógica.
const BUDGET = () => ({ remaining: 50, throttleMs: 0 });

describe('ingestPage — candidato conhecido acumula sinal em vez de congelar', () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockReset();
    createMany.mockReset();
    getScanResult.mockReset();
    // Por padrão o pass não encontra nada para medir (toMeasure vazio) — os
    // testes de sinal configuram o retorno explicitamente.
    getScanResult.mockResolvedValue(null);
  });

  it('candidato inédito é criado via createMany e conta em onNew', async () => {
    findMany.mockResolvedValue([]);
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    expect(cb.onNew).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(1);
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].hitCount).toBe(1);
  });

  it('candidato conhecido acumula hitCount por increment, não substitui o valor', async () => {
    findMany.mockResolvedValue([
      {
        id: 'cand-1',
        dedupeKey: 'metodoxyz.com.br',
        firstSeenAt: new Date('2026-07-01T00:00:00Z'),
        lastSeenAt: new Date('2026-07-05T00:00:00Z'),
      },
    ]);
    const cb = callbacks();

    // Uma única chamada de ingestPage com dois hits do mesmo domínio: testa a
    // agregação intra-página (aggregateHits somando para hitCount 2), não a
    // transição de cursor entre duas páginas de uma rodada — isso é coberto
    // em harvest.ts pelo laço de `page` em `harvest()`, fora do escopo de
    // ingestPage.
    await ingestPage(
      [hit({ uuid: 'a' }), hit({ uuid: 'b', pageUrl: 'https://metodoxyz.com.br/lp' })],
      'resource',
      source,
      'run-1',
      cb,
      BUDGET(),
    );

    expect(createMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.hitCount).toEqual({ increment: 2 });
  });

  it('candidato conhecido não conta em onNew/onQueue/onDiscard', async () => {
    findMany.mockResolvedValue([
      {
        id: 'cand-1',
        dedupeKey: 'metodoxyz.com.br',
        firstSeenAt: new Date('2026-07-01T00:00:00Z'),
        lastSeenAt: new Date('2026-07-05T00:00:00Z'),
      },
    ]);
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    expect(cb.onNew).not.toHaveBeenCalled();
    expect(cb.onQueue).not.toHaveBeenCalled();
    expect(cb.onDiscard).not.toHaveBeenCalled();
  });

  it('candidato já triado tem o sinal atualizado mas o update nunca toca status/discardReason/triagedAt', async () => {
    findMany.mockResolvedValue([
      {
        id: 'cand-1',
        dedupeKey: 'metodoxyz.com.br',
        firstSeenAt: new Date('2026-07-01T00:00:00Z'),
        lastSeenAt: new Date('2026-07-05T00:00:00Z'),
      },
    ]);
    const cb = callbacks();

    // A linha "known" simulada aqui já poderia estar com status 'promoted' e
    // triagedAt preenchido no banco de verdade — o findMany nem devolve esses
    // campos porque o update jamais precisa (nem pode) decidir sobre eles.
    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('discardReason');
    expect(data).not.toHaveProperty('triagedAt');
  });

  it('firstSeenAt/lastSeenAt só se movem para alargar a janela, nunca para encolher', async () => {
    findMany.mockResolvedValue([
      {
        id: 'cand-1',
        dedupeKey: 'metodoxyz.com.br',
        firstSeenAt: new Date('2026-07-01T00:00:00Z'),
        lastSeenAt: new Date('2026-07-05T00:00:00Z'),
      },
    ]);
    const cb = callbacks();

    // Hit dentro da janela já gravada: nem firstSeenAt nem lastSeenAt deveriam mudar.
    await ingestPage([hit({ time: '2026-07-03T00:00:00Z' })], 'resource', source, 'run-1', cb, BUDGET());

    const data = update.mock.calls[0][0].data;
    expect(data.firstSeenAt).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(data.lastSeenAt).toEqual(new Date('2026-07-05T00:00:00Z'));
  });
});

describe('ingestPage — ressurreição temporal e signal pass', () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockReset();
    createMany.mockReset();
    getScanResult.mockReset();
  });

  const known = (over: Record<string, unknown> = {}) => ({
    id: 'cand-1',
    dedupeKey: 'metodoxyz.com.br',
    firstSeenAt: new Date('2026-07-01T00:00:00Z'),
    lastSeenAt: new Date('2026-07-05T00:00:00Z'),
    ...over,
  });

  it('descartado por sem-circulacao ressuscita quando re-avistado dentro da janela', async () => {
    findMany.mockResolvedValueOnce([
      known({ status: 'discarded_auto', discardReason: 'sem-circulacao' }),
    ]);
    findMany.mockResolvedValue([]); // toMeasure
    const cb = callbacks();

    // hit de 2026-07-10 está bem dentro dos 90 dias da regra
    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('pending');
    expect(data.discardReason).toBeNull();
    expect(cb.onQueue).toHaveBeenCalledWith('metodoxyz.com.br');
  });

  it('descarte de CATEGORIA (golpe) é permanente — não ressuscita', async () => {
    findMany.mockResolvedValueOnce([
      known({ status: 'discarded_auto', discardReason: 'golpe-phishing' }),
    ]);
    findMany.mockResolvedValue([]);
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(cb.onQueue).not.toHaveBeenCalled();
  });

  it('medido com zero sinal é descartado e corrige os contadores via onSignalDiscard', async () => {
    findMany.mockResolvedValueOnce([]); // ninguém conhecido
    findMany.mockResolvedValueOnce([
      {
        id: 'novo-1', dedupeKey: 'metodoxyz.com.br', scanUuid: 'u1', screenshotUrl: null,
        hitCount: 1, daysRunning: 0, lastSeenAt: new Date('2026-07-10T00:00:00Z'), domainAgeDays: 10,
      },
    ]);
    getScanResult.mockResolvedValue({
      domains: ['fonts.gstatic.com'], linkDomains: [], malicious: false,
      domainAgeDays: 10, tlsAgeDays: 3,
    });
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    expect(cb.onQueue).toHaveBeenCalledTimes(1); // entrou na fila…
    expect(cb.onSignalDiscard).toHaveBeenCalledWith('metodoxyz.com.br', 'sem-sinal-trafego'); // …e saiu medido
    const updates = update.mock.calls.map((c) => c[0].data);
    expect(updates.some((d) => d.discardReason === 'sem-sinal-trafego' && d.signalScore != null)).toBe(true);
  });

  it('veredito malicioso do urlscan descarta com a razão própria', async () => {
    findMany.mockResolvedValueOnce([]);
    findMany.mockResolvedValueOnce([
      {
        id: 'novo-1', dedupeKey: 'metodoxyz.com.br', scanUuid: 'u1', screenshotUrl: null,
        hitCount: 3, daysRunning: 2, lastSeenAt: new Date('2026-07-10T00:00:00Z'), domainAgeDays: 5,
      },
    ]);
    getScanResult.mockResolvedValue({
      domains: ['connect.facebook.net'], linkDomains: [], malicious: true,
      domainAgeDays: 5, tlsAgeDays: 1,
    });
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    expect(cb.onSignalDiscard).toHaveBeenCalledWith('metodoxyz.com.br', 'malicioso-urlscan');
  });

  it('com pixel medido, candidato permanece na fila com score e hasAdPixel', async () => {
    findMany.mockResolvedValueOnce([]);
    findMany.mockResolvedValueOnce([
      {
        id: 'novo-1', dedupeKey: 'metodoxyz.com.br', scanUuid: 'u1', screenshotUrl: null,
        hitCount: 8, daysRunning: 4, lastSeenAt: new Date('2026-07-10T00:00:00Z'), domainAgeDays: 12,
      },
    ]);
    getScanResult.mockResolvedValue({
      domains: ['connect.facebook.net', 'analytics.tiktok.com', 'cdn.utmify.com.br'],
      linkDomains: ['pay.kiwify.com.br'], malicious: false, domainAgeDays: 12, tlsAgeDays: 4,
    });
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb, BUDGET());

    expect(cb.onSignalDiscard).not.toHaveBeenCalled();
    const final = update.mock.calls.map((c) => c[0].data).find((d) => d.signalScore != null)!;
    expect(final.hasAdPixel).toBe(true);
    expect(final.signalScore).toBeGreaterThan(50);
    expect(final).not.toHaveProperty('status'); // continua pending
    expect(final.signals.tags).toContain('escalando-agora'); // domínio de 12d + pixel + 2 hits/dia
  });
});
