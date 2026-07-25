import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawHit } from '../lib/aggregate';

const findMany = vi.fn();
const update = vi.fn();
const createMany = vi.fn();

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
  return { onNew, onDiscard, onQueue };
}

describe('ingestPage — candidato conhecido acumula sinal em vez de congelar', () => {
  beforeEach(() => {
    findMany.mockReset();
    update.mockReset();
    createMany.mockReset();
  });

  it('candidato inédito é criado via createMany e conta em onNew', async () => {
    findMany.mockResolvedValue([]);
    const cb = callbacks();

    await ingestPage([hit({})], 'resource', source, 'run-1', cb);

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

    // Duas páginas da mesma rodada: hits do mesmo domínio se agregam a hitCount 2.
    await ingestPage(
      [hit({ uuid: 'a' }), hit({ uuid: 'b', pageUrl: 'https://metodoxyz.com.br/lp' })],
      'resource',
      source,
      'run-1',
      cb,
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

    await ingestPage([hit({})], 'resource', source, 'run-1', cb);

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
    await ingestPage([hit({})], 'resource', source, 'run-1', cb);

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
    await ingestPage([hit({ time: '2026-07-03T00:00:00Z' })], 'resource', source, 'run-1', cb);

    const data = update.mock.calls[0][0].data;
    expect(data.firstSeenAt).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(data.lastSeenAt).toEqual(new Date('2026-07-05T00:00:00Z'));
  });
});
