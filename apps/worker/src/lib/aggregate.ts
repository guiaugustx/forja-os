// Agregação dos hits crus do urlscan em candidatos.
//
// O ponto: hits repetidos da mesma chave NÃO são lixo — são o sinal de
// circulação. Contá-los aqui entrega hitCount/firstSeen/lastSeen de graça,
// na mesma varredura, em vez de recomprar o dado com uma chamada por domínio
// (getDomainActivity), que em milhares de domínios estoura o rate limit.

import { buildDedupeKey, type HarvestKind } from './dedupeKey';

export interface RawHit {
  uuid: string;
  pageUrl: string;
  pageDomain: string;
  title: string | null;
  time: string | null;
  referer: string | null;
}

export interface AggregatedCandidate {
  dedupeKey: string;
  url: string;
  domain: string;
  title: string | null;
  screenshotUrl: string | null;
  referer: string | null;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysRunning: number;
}

const DAY_MS = 86_400_000;

export function aggregateHits(hits: RawHit[], kind: HarvestKind): AggregatedCandidate[] {
  const byKey = new Map<string, AggregatedCandidate>();

  for (const h of hits) {
    if (!h.pageUrl || !h.pageDomain) continue;
    const dedupeKey = buildDedupeKey(kind, h);
    const time = h.time ? new Date(h.time) : null;
    const stamp = time && !Number.isNaN(time.getTime()) ? time.toISOString() : null;

    const found = byKey.get(dedupeKey);
    if (!found) {
      byKey.set(dedupeKey, {
        dedupeKey,
        url: h.pageUrl,
        domain: h.pageDomain.toLowerCase(),
        title: h.title,
        screenshotUrl: h.uuid ? `https://urlscan.io/screenshots/${h.uuid}.png` : null,
        referer: h.referer,
        hitCount: 1,
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        daysRunning: 0,
      });
      continue;
    }

    found.hitCount++;
    if (!found.title && h.title) found.title = h.title;
    if (!found.referer && h.referer) found.referer = h.referer;
    if (stamp) {
      if (!found.firstSeenAt || stamp < found.firstSeenAt) found.firstSeenAt = stamp;
      if (!found.lastSeenAt || stamp > found.lastSeenAt) found.lastSeenAt = stamp;
    }
  }

  const out = Array.from(byKey.values());
  for (const c of out) {
    c.daysRunning =
      c.firstSeenAt && c.lastSeenAt
        ? Math.max(0, Math.round((Date.parse(c.lastSeenAt) - Date.parse(c.firstSeenAt)) / DAY_MS))
        : 0;
  }
  return out.sort((a, b) => b.hitCount - a.hitCount);
}
