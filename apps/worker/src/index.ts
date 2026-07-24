import { Worker } from 'bullmq';
import { connection, queues, INGEST_QUEUE } from './queues';
import { ingestOffers } from './jobs/ingestOffers';

console.log('⚙️  Forja Worker iniciado. Aguardando jobs...');

// Consumidor da ingestão de ofertas (urlscan → raio-x IA → score → Offer).
new Worker(INGEST_QUEUE, ingestOffers, { connection, concurrency: 1 });

// Agendamento periódico (além do disparo sob demanda pela API).
async function schedule() {
  const hours = Number(process.env.INGEST_SCHEDULE_HOURS ?? 6);
  if (hours > 0) {
    await queues.ingestOffers.add(
      'scheduled',
      {},
      { repeat: { every: hours * 60 * 60 * 1000 }, jobId: 'ingest-scheduled' },
    );
    console.log(`⏱️  Ingestão agendada a cada ${hours}h.`);
  }
}
schedule().catch((e) => console.error('Falha ao agendar ingestão:', e));

process.on('SIGTERM', async () => {
  await connection.quit();
  process.exit(0);
});
