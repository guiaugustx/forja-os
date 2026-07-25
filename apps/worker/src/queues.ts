import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const HARVEST_QUEUE = 'harvest';
export const ENRICH_QUEUE = 'enrich';

// Filas do sistema. Tudo que toca integração externa roda aqui, nunca no request.
// harvest é barato e em massa; enrich é caro e sob demanda — separados para que
// uma colheita longa nunca segure o enriquecimento de um item recém-promovido.
export const queues = {
  harvest: new Queue(HARVEST_QUEUE, { connection }),
  enrich: new Queue(ENRICH_QUEUE, { connection }),
  syncBalances: new Queue('sync-balances', { connection }),
  pullAdMetrics: new Queue('pull-ad-metrics', { connection }),
  processWebhook: new Queue('process-webhook', { connection }),
};
