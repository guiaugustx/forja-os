// Fontes iniciais de mineração. A lista definitiva sai do reconhecimento
// (apps/worker/scripts/recon-sources.ts) — estas são o ponto de partida.
import { prisma } from '../src/index';

// Lista ajustada pelo reconhecimento (apps/worker/scripts/recon-sources.ts):
// Panda Video e Ticto renderam zero chaves e saíram do cadastro; Kiwify e
// Hotmart não têm gateway de checkout linkável (só carregado como recurso
// embutido), então entram pela forma invertida, que rendeu bem para os dois.
const SOURCES = [
  { name: 'Utmify (rastreador)', query: 'domain:cdn.utmify.com.br', kind: 'resource' as const },
  { name: 'ConverteAI (player VSL)', query: 'domain:cdn.converteai.net', kind: 'resource' as const },
  { name: 'Klickpages', query: 'domain:klickpages.com.br', kind: 'resource' as const },
  { name: 'Cakto (checkout)', query: 'page.domain:pay.cakto.com.br', kind: 'checkout' as const },
  { name: 'Kirvano (checkout)', query: 'page.domain:pay.kirvano.com', kind: 'checkout' as const },
  {
    name: 'Kiwify (invertida)',
    query: 'domain:pay.kiwify.com.br AND NOT page.domain:pay.kiwify.com.br',
    kind: 'resource' as const,
  },
  {
    name: 'Hotmart (invertida)',
    query: 'domain:pay.hotmart.com AND NOT page.domain:pay.hotmart.com',
    kind: 'resource' as const,
  },
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

// Desconecta antes de sair: process.exit() dentro do catch mataria o processo
// antes do finally rodar, deixando a conexão pendurada no Postgres.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
