// Fontes iniciais de mineração. A lista definitiva sai do reconhecimento
// (apps/worker/scripts/recon-sources.ts) — estas são o ponto de partida.
import { prisma } from '../src/index';

const SOURCES = [
  { name: 'Utmify (rastreador)', query: 'domain:cdn.utmify.com.br', kind: 'resource' as const },
  { name: 'ConverteAI (player VSL)', query: 'domain:cdn.converteai.net', kind: 'resource' as const },
  { name: 'Panda Video', query: 'domain:cdn.pandavideo.com.br', kind: 'resource' as const },
  { name: 'Klickpages', query: 'domain:klickpages.com.br', kind: 'resource' as const },
  { name: 'Cakto (checkout)', query: 'page.domain:pay.cakto.com.br', kind: 'checkout' as const },
  { name: 'Kirvano (checkout)', query: 'page.domain:pay.kirvano.com', kind: 'checkout' as const },
  { name: 'Ticto (checkout)', query: 'page.domain:pay.ticto.com.br', kind: 'checkout' as const },
];

async function main() {
  for (const s of SOURCES) {
    await prisma.harvestSource.upsert({
      where: { query: s.query },
      update: { name: s.name, kind: s.kind },
      create: s,
    });
    console.log(`✓ ${s.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
