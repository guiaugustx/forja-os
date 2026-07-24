import { PrismaClient } from '@prisma/client';

// Remove ofertas de delivery/comida já existentes (aplicado uma vez; a ingestão
// nova já bloqueia essas categorias na origem).
const prisma = new PrismaClient();

const BLOCK = [
  'delivery', 'ifood', 'rappi', 'restaurante', 'lanchonet', 'lanche', 'hamburg', 'burger',
  'pizzaria', 'pizza', 'marmita', 'açai', 'acai', 'fast food', 'sorveteria', 'padaria', 'pastel',
  'sushi', 'temaki', 'açougue', 'hortifruti', 'mercearia', 'churrasc', 'espetinho', 'comida',
  'food', 'refei', 'cardapio', 'cardápio',
];

async function main() {
  const offers = await prisma.offer.findMany({ where: { source: 'urlscan' } });
  const hay = (o: (typeof offers)[number]) => {
    const x = (o.xray ?? {}) as { category?: string; niche?: string };
    return `${o.advertiser} ${o.name} ${o.niche} ${x.category ?? ''} ${x.niche ?? ''}`.toLowerCase();
  };
  const toDelete = offers.filter((o) => BLOCK.some((k) => hay(o).includes(k)));

  let deleted = 0;
  for (const o of toDelete) {
    try {
      await prisma.offerDraft.updateMany({ where: { sourceOfferId: o.id }, data: { sourceOfferId: null } });
      await prisma.opportunity.deleteMany({ where: { offerId: o.id } });
      await prisma.offer.delete({ where: { id: o.id } });
      deleted++;
    } catch (e) {
      console.log(`  não deletou ${o.advertiser}: ${(e as Error).message}`);
    }
  }
  console.log(`🧹 deletadas ${deleted} ofertas delivery/comida; restam ${offers.length - deleted}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
