import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const INGEST_QUEUE = 'ingest-offers';

// Filas do sistema. Tudo que toca integração externa roda aqui, nunca no request.
export const queues = {
  ingestOffers: new Queue(INGEST_QUEUE, { connection }),
  syncBalances: new Queue('sync-balances', { connection }),
  pullAdMetrics: new Queue('pull-ad-metrics', { connection }),
  processWebhook: new Queue('process-webhook', { connection }),
};
