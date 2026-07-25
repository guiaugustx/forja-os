import { describe, it, expect } from 'vitest';
import { mergeCandidateSignal } from './mergeCandidate';
import type { AggregatedCandidate } from './aggregate';

const candidate = (over: Partial<AggregatedCandidate>): AggregatedCandidate => ({
  dedupeKey: 'k1',
  url: 'https://metodoxyz.com.br/vsl',
  domain: 'metodoxyz.com.br',
  title: 'Método X',
  screenshotUrl: null,
  referer: null,
  hitCount: 1,
  firstSeenAt: '2026-07-10T00:00:00.000Z',
  lastSeenAt: '2026-07-10T00:00:00.000Z',
  daysRunning: 0,
  ...over,
});

describe('mergeCandidateSignal — acumulação de circulação para candidato conhecido', () => {
  it('acumula hitCount em vez de substituir', () => {
    const merge = mergeCandidateSignal(candidate({ hitCount: 5 }), {
      firstSeenAt: new Date('2026-07-01T00:00:00Z'),
      lastSeenAt: new Date('2026-07-05T00:00:00Z'),
    });
    expect(merge.hitCountIncrement).toBe(5);
  });

  it('alarga firstSeenAt para trás quando o novo hit é mais antigo', () => {
    const merge = mergeCandidateSignal(
      candidate({ firstSeenAt: '2026-06-01T00:00:00.000Z', lastSeenAt: '2026-06-01T00:00:00.000Z' }),
      { firstSeenAt: new Date('2026-06-15T00:00:00Z'), lastSeenAt: new Date('2026-06-20T00:00:00Z') },
    );
    expect(merge.firstSeenAt).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('não move firstSeenAt para frente quando o novo hit é mais recente que o já gravado', () => {
    const merge = mergeCandidateSignal(
      candidate({ firstSeenAt: '2026-07-20T00:00:00.000Z', lastSeenAt: '2026-07-20T00:00:00.000Z' }),
      { firstSeenAt: new Date('2026-06-15T00:00:00Z'), lastSeenAt: new Date('2026-06-20T00:00:00Z') },
    );
    expect(merge.firstSeenAt).toEqual(new Date('2026-06-15T00:00:00Z'));
  });

  it('alarga lastSeenAt para frente quando o novo hit é mais recente', () => {
    const merge = mergeCandidateSignal(
      candidate({ firstSeenAt: '2026-07-25T00:00:00.000Z', lastSeenAt: '2026-07-25T00:00:00.000Z' }),
      { firstSeenAt: new Date('2026-06-15T00:00:00Z'), lastSeenAt: new Date('2026-06-20T00:00:00Z') },
    );
    expect(merge.lastSeenAt).toEqual(new Date('2026-07-25T00:00:00Z'));
  });

  it('não move lastSeenAt para trás quando o novo hit é mais antigo que o já gravado', () => {
    const merge = mergeCandidateSignal(
      candidate({ firstSeenAt: '2026-06-10T00:00:00.000Z', lastSeenAt: '2026-06-10T00:00:00.000Z' }),
      { firstSeenAt: new Date('2026-06-01T00:00:00Z'), lastSeenAt: new Date('2026-07-01T00:00:00Z') },
    );
    expect(merge.lastSeenAt).toEqual(new Date('2026-07-01T00:00:00Z'));
  });

  it('recalcula daysRunning a partir da janela resultante, não da página isolada', () => {
    const merge = mergeCandidateSignal(
      candidate({ firstSeenAt: '2026-06-01T00:00:00.000Z', lastSeenAt: '2026-06-01T00:00:00.000Z' }),
      { firstSeenAt: new Date('2026-06-01T00:00:00Z'), lastSeenAt: new Date('2026-07-01T00:00:00Z') },
    );
    expect(merge.daysRunning).toBe(30);
  });

  it('lida com known sem datas gravadas (linha antiga sem firstSeenAt/lastSeenAt)', () => {
    const merge = mergeCandidateSignal(candidate({}), { firstSeenAt: null, lastSeenAt: null });
    expect(merge.firstSeenAt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(merge.lastSeenAt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
  });

  it('lida com candidato agregado sem stamp de tempo (time ausente no hit)', () => {
    const merge = mergeCandidateSignal(candidate({ firstSeenAt: null, lastSeenAt: null }), {
      firstSeenAt: new Date('2026-06-01T00:00:00Z'),
      lastSeenAt: new Date('2026-06-20T00:00:00Z'),
    });
    expect(merge.firstSeenAt).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(merge.lastSeenAt).toEqual(new Date('2026-06-20T00:00:00Z'));
  });
});
