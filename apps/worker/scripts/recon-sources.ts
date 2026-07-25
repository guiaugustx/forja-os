/**
 * Reconhecimento de fontes: roda cada query candidata, conta quantas chaves
 * distintas ela rende e mostra uma amostra. Serve para decidir a lista de
 * HarvestSource com dado, não com palpite — queries que rendem zero ou lixo
 * ficam de fora.
 *
 * Uso: pnpm --filter @forja/worker recon
 */
import { searchPage } from '../src/adapters/urlscan';
import { aggregateHits } from '../src/lib/aggregate';
import type { HarvestKind } from '../src/lib/dedupeKey';

const CANDIDATES: Array<{ name: string; query: string; kind: HarvestKind }> = [
  { name: 'Utmify', query: 'domain:cdn.utmify.com.br', kind: 'resource' },
  { name: 'ConverteAI', query: 'domain:cdn.converteai.net', kind: 'resource' },
  { name: 'Panda Video', query: 'domain:cdn.pandavideo.com.br', kind: 'resource' },
  { name: 'Klickpages', query: 'domain:klickpages.com.br', kind: 'resource' },
  { name: 'Cakto (checkout)', query: 'page.domain:pay.cakto.com.br', kind: 'checkout' },
  { name: 'Kirvano (checkout)', query: 'page.domain:pay.kirvano.com', kind: 'checkout' },
  { name: 'Ticto (checkout)', query: 'page.domain:pay.ticto.com.br', kind: 'checkout' },
  { name: 'Cakto invertida', query: 'domain:pay.cakto.com.br AND NOT page.domain:pay.cakto.com.br', kind: 'resource' },
  { name: 'Kiwify invertida', query: 'domain:pay.kiwify.com.br AND NOT page.domain:pay.kiwify.com.br', kind: 'resource' },
  { name: 'Hotmart invertida', query: 'domain:pay.hotmart.com AND NOT page.domain:pay.hotmart.com', kind: 'resource' },
];

const PAGES = 3;

async function recon(c: (typeof CANDIDATES)[number]) {
  const hits = [];
  let cursor: string | null = null;

  for (let p = 0; p < PAGES; p++) {
    const page = await searchPage({ query: c.query, cursor, size: 100 });
    hits.push(...page.hits);
    cursor = page.nextCursor;
    if (!cursor || page.pageSize < 100) break;
  }

  const candidates = aggregateHits(hits, c.kind);
  const sample = candidates.slice(0, 5).map((x) => `${x.dedupeKey} (${x.hitCount}×)`);

  console.log(`\n▸ ${c.name}`);
  console.log(`  query   : ${c.query}`);
  console.log(`  brutos  : ${hits.length}`);
  console.log(`  chaves  : ${candidates.length}`);
  console.log(`  amostra : ${sample.join('\n            ') || '—'}`);
}

async function main() {
  if (!process.env.URLSCAN_API_KEY) {
    console.warn('⚠️  Sem URLSCAN_API_KEY — o rate limit anônimo vai truncar os resultados.\n');
  }
  for (const c of CANDIDATES) {
    try {
      await recon(c);
    } catch (err) {
      console.log(`\n▸ ${c.name}\n  ✕ falhou: ${(err as Error).message}`);
    }
  }
}

main();
