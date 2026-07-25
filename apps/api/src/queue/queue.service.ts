import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Produtor de jobs — a API enfileira, o worker consome.
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  readonly harvest = new Queue('harvest', { connection: this.connection });
  readonly enrich = new Queue('enrich', { connection: this.connection });

  async onModuleDestroy() {
    await this.harvest.close();
    await this.enrich.close();
    await this.connection.quit();
  }
}
