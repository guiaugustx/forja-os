import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Semeando Forja OS...');

  // ---- Produtos ----
  const sono = await prisma.product.create({
    data: {
      name: 'Manual do Sono Profundo',
      market: 'BR',
      currency: 'BRL',
      priceCents: 2700,
      gateway: 'cakto',
      stage: 'scaling',
      brief: {
        persona: 'Adultos 30–55 com insônia',
        promise: 'Dormir em 7 noites',
        format: 'Ebook + áudios',
        angle: 'Depoimento 1ª pessoa',
      },
    },
  });

  const dog = await prisma.product.create({
    data: {
      name: 'Dog Training Blueprint',
      market: 'US',
      currency: 'USD',
      priceCents: 1700,
      gateway: 'stripe',
      stage: 'scaling',
    },
  });

  const keto = await prisma.product.create({
    data: {
      name: 'Recetas Keto Express',
      market: 'ES',
      currency: 'USD',
      priceCents: 990,
      gateway: 'stripe',
      stage: 'funnel',
    },
  });

  await prisma.product.createMany({
    data: [
      { name: 'Planner Financeiro 2027', market: 'BR', priceCents: 1990, gateway: 'cakto', stage: 'production' },
      { name: 'AI Prompts Vault', market: 'US', currency: 'USD', priceCents: 1490, gateway: 'stripe', stage: 'validation' },
      { name: 'Rotina Montessori em Casa', market: 'BR', priceCents: 2990, gateway: 'cakto', stage: 'validation' },
    ],
  });

  // ---- Funil do produto em escala ----
  const funnel = await prisma.funnel.create({
    data: {
      productId: sono.id,
      name: 'Funil principal',
      status: 'published',
      steps: {
        create: [
          { position: 0, type: 'ad', config: { platform: 'meta' } },
          { position: 1, type: 'advertorial' },
          { position: 2, type: 'lp' },
          { position: 3, type: 'checkout', config: { priceCents: 2700 } },
          { position: 4, type: 'bump', config: { priceCents: 990 } },
          { position: 5, type: 'upsell', config: { priceCents: 4700 } },
        ],
      },
    },
  });

  // ---- Criativos ----
  await prisma.creative.createMany({
    data: [
      { productId: sono.id, name: 'SONO-V07 · hook 3h da manhã', format: '9x16', kind: 'video', hook: '3h da manhã', status: 'running', platform: 'meta' },
      { productId: sono.id, name: 'SONO-V04 · melatonina', format: '9x16', kind: 'video', hook: 'melatonina', status: 'running', platform: 'meta' },
      { productId: dog.id, name: 'DOG-E02 · 5 min per day', format: '1x1', kind: 'static', status: 'running', platform: 'meta' },
    ],
  });

  // ---- Campanhas + métricas ----
  const camp = await prisma.campaign.create({
    data: {
      productId: sono.id,
      funnelId: funnel.id,
      platform: 'meta',
      name: 'Sono — Advantage+ BR',
      status: 'active',
      dailyBudgetCents: 30000,
    },
  });
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    await prisma.campaignMetricDaily.create({
      data: {
        campaignId: camp.id,
        date: new Date(d.toISOString().slice(0, 10)),
        spendCents: 42000 + Math.round(Math.random() * 20000),
        clicks: 800 + Math.round(Math.random() * 400),
        purchases: 30 + Math.round(Math.random() * 20),
        cpaCents: 1020,
        roas: 2.6 + Math.random() * 0.6,
      },
    });
  }

  // ---- Transações ----
  await prisma.transaction.createMany({
    data: [
      { productId: sono.id, gateway: 'cakto', externalId: 'ckt_1', type: 'sale', method: 'pix', amountCents: 3690, status: 'approved' },
      { productId: sono.id, gateway: 'cakto', externalId: 'ckt_2', type: 'sale', method: 'card', amountCents: 2700, status: 'approved' },
      { productId: dog.id, gateway: 'stripe', externalId: 'str_1', currency: 'USD', type: 'sale', method: 'card', amountCents: 1700, status: 'approved' },
      { productId: sono.id, gateway: 'cakto', externalId: 'ckt_3', type: 'sale', method: 'pix', amountCents: 7400, status: 'approved' },
    ],
  });

  // ---- Saldos ----
  await prisma.gatewayBalance.createMany({
    data: [
      { gateway: 'cakto', availableCents: 1248000, pendingCents: 832000, currency: 'BRL' },
      { gateway: 'stripe', availableCents: 310400, pendingCents: 0, currency: 'USD' },
      { gateway: 'hotmart', availableCents: 194000, pendingCents: 221000, currency: 'BRL' },
    ],
  });

  // ---- Radar: ofertas mineradas (formato pós-ingestão urlscan) ----
  await prisma.offer.createMany({
    data: [
      {
        source: 'urlscan',
        advertiser: 'metodosono.com.br',
        name: 'Método Sono Restaurador',
        market: 'BR',
        niche: 'saude/sono',
        ticketEstCents: 2700,
        angle: 'Autoridade médica',
        pageUrl: 'https://metodosono.com.br/oferta',
        screenshotUrl: 'https://urlscan.io/screenshots/example-sono.png',
        detectedGateway: 'cakto',
        daysRunning: 142,
        scanCount: 38,
        opportunityScore: 82,
        saved: true,
        xray: {
          promise: 'Dormir a noite inteira em 7 dias.',
          mechanism: 'Protocolo circadiano em 3 fases.',
          avatar: 'Adultos 30–55 com insônia crônica.',
          pain: 'Acordar às 3h e não voltar a dormir.',
          guarantee: '7 dias de garantia.',
          angle: 'Autoridade médica',
          niche: 'saude/sono',
          market: 'BR',
          ticketEstCents: 2700,
        },
      },
      {
        source: 'urlscan',
        advertiser: 'plannerpro.com.br',
        name: 'Planner Financeiro 2027',
        market: 'BR',
        niche: 'financas',
        ticketEstCents: 1990,
        angle: 'Virada de ano',
        pageUrl: 'https://plannerpro.com.br/2027',
        screenshotUrl: 'https://urlscan.io/screenshots/example-planner.png',
        detectedGateway: 'hotmart',
        daysRunning: 63,
        scanCount: 12,
        opportunityScore: 61,
      },
      {
        source: 'urlscan',
        advertiser: 'vidaketo.es',
        name: 'Recetas Sin Harinas',
        market: 'ES',
        niche: 'nutricao',
        ticketEstCents: 990,
        angle: 'Identidade',
        pageUrl: 'https://vidaketo.es/recetas',
        screenshotUrl: 'https://urlscan.io/screenshots/example-keto.png',
        detectedGateway: 'stripe',
        daysRunning: 97,
        scanCount: 21,
        opportunityScore: 74,
      },
    ],
  });

  // ---- Radar: trends ----
  await prisma.termTrend.createMany({
    data: [
      { term: 'sleep divorce', market: 'US', volumeMonthly: 82000, growth90d: '+410%', status: 'breakout' },
      { term: 'ozempic caseiro natural', market: 'BR', volumeMonthly: 82000, growth90d: '+320%', status: 'breakout' },
      { term: 'manual do sono', market: 'BR', volumeMonthly: 78720, growth90d: '+58%', status: 'rising' },
      { term: 'planner financeiro', market: 'BR', volumeMonthly: 77900, status: 'seasonal' },
    ],
  });

  // ---- Integrações ----
  await prisma.integration.createMany({
    data: [
      { provider: 'siliconflow', status: 'disconnected', meta: { role: 'ia', model: 'Qwen/Qwen2.5-72B-Instruct' } },
      { provider: 'urlscan', status: 'disconnected', meta: { role: 'ingestao' } },
      { provider: 'serpapi', status: 'disconnected', meta: { role: 'trends', optional: true } },
      { provider: 'cakto', status: 'connected' },
      { provider: 'stripe', status: 'connected' },
      { provider: 'hotmart', status: 'connected' },
      { provider: 'meta', status: 'connected' },
      { provider: 'tiktok', status: 'connected' },
    ],
  });

  console.log('✅ Seed concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
