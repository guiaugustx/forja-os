// Fontes iniciais de mineração. A lista definitiva sai do reconhecimento
// (apps/worker/scripts/recon-sources.ts) — estas são o ponto de partida.
import { prisma } from '../src/index';

// Lista ajustada pelo reconhecimento (apps/worker/scripts/recon-sources.ts):
// Panda Video e Ticto renderam zero chaves e saíram do cadastro. Para Kiwify e
// Hotmart só a forma invertida foi medida — e rendeu as melhores da lista (173 e
// 199 chaves); a forma direta de checkout não chegou a ser testada.
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
      // `enabled: true` também no update: uma fonte que caiu da lista (e foi
      // desabilitada pelo updateMany abaixo numa rodada anterior do seed) e
      // depois voltou a aparecer aqui precisa reabilitar — sem isto ela
      // continuava enabled:false para sempre, e a API (que filtra por
      // enabled:true) some da colheita em silêncio mesmo com a fonte de volta
      // à lista definitiva.
      update: { name: s.name, kind: s.kind, enabled: true },
      create: s,
    });
    console.log(`✓ ${s.name}`);
  }

  // Desabilita o que saiu da lista. Sem isto, uma fonte reprovada pelo
  // reconhecimento continuaria sendo varrida a cada colheita em qualquer banco
  // que já tivesse rodado o seed antes — a decisão de tirá-la não teria efeito.
  // Desabilita em vez de apagar porque os candidatos já colhidos apontam para a
  // fonte, e o histórico de onde cada um veio importa na aba de descartados.
  const { count } = await prisma.harvestSource.updateMany({
    where: { query: { notIn: SOURCES.map((s) => s.query) }, enabled: true },
    data: { enabled: false },
  });
  if (count > 0) console.log(`↓ ${count} fonte(s) fora da lista desabilitada(s)`);
}

// Desconecta antes de sair: process.exit() dentro do catch mataria o processo
// antes do finally rodar, deixando a conexão pendurada no Postgres.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
