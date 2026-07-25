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
  // Atenção: `undo()` (candidates.service.ts) depende de `enrich.getJob()`
  // ainda encontrar o job depois de concluído/falho para decidir se o
  // enriquecimento já começou. Isso só funciona porque nem aqui nem no
  // worker (apps/worker/src/index.ts) há `removeOnComplete`/`removeOnFail`
  // nas opções desta fila — o BullMQ retém os jobs terminados. Se algum dia
  // alguém adicionar essa retenção (prática comum pra não encher o Redis),
  // `getJob` passa a devolver `null` para jobs já processados, e `undo()`
  // volta a tratar isso como "seguro apagar" mesmo quando a IA já rodou —
  // sem trava nenhuma. Não adicione `removeOnComplete`/`removeOnFail` aqui
  // sem revisar `undo()` junto.
  readonly enrich = new Queue('enrich', { connection: this.connection });

  async onModuleDestroy() {
    await this.harvest.close();
    await this.enrich.close();
    await this.connection.quit();
  }
}
