import { PrismaClient } from '@prisma/client';

// Clean slate: remove TODAS as ofertas mineradas do urlscan (para re-minerar com
// os gates novos: página de vendas viva + digital + com tráfego + sem delivery).
const prisma = new PrismaClient();

async function main() {
  const ids = (await prisma.offer.findMany({ where: { source: 'urlscan' }, select: { id: true } })).map((o) => o.id);
  if (ids.length === 0) {
    console.log('nada a remover.');
    return;
  }
  await prisma.offerDraft.updateMany({ where: { sourceOfferId: { in: ids } }, data: { sourceOfferId: null } });
  await prisma.opportunity.deleteMany({ where: { offerId: { in: ids } } });
  const r = await prisma.offer.deleteMany({ where: { id: { in: ids } } });
  console.log(`🧹 removidas ${r.count} ofertas urlscan (clean slate)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
