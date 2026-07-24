import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Produtor de jobs — a API enfileira a ingestão; o worker consome.
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  readonly ingestOffers = new Queue('ingest-offers', { connection: this.connection });

  async onModuleDestroy() {
    await this.ingestOffers.close();
    await this.connection.quit();
  }
}
