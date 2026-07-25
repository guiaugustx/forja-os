import { Worker } from 'bullmq';
import { connection, HARVEST_QUEUE, ENRICH_QUEUE } from './queues';
import { harvest } from './jobs/harvest';
import { enrich } from './jobs/enrich';

console.log('⚙️  Forja Worker iniciado. Aguardando jobs...');

// Colheita: urlscan → agregação → pré-filtro → Candidate. Barata e em massa.
// Serial de propósito, para não competir por rate limit do urlscan consigo mesma.
new Worker(HARVEST_QUEUE, harvest, { connection, concurrency: 1 });

// Enriquecimento: download + raio-x IA + tráfego + trend + score. Caro e sob
// demanda, com paralelismo modesto para não estourar o rate limit da IA.
new Worker(ENRICH_QUEUE, enrich, { connection, concurrency: 3 });

// Sem agendamento periódico: a colheita é disparada exclusivamente por ação
// humana, no botão do Radar.

process.on('SIGTERM', async () => {
  await connection.quit();
  process.exit(0);
});
