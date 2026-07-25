import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { HarvestInput, OfferStageInput } from './radar.dto';

@Injectable()
export class RadarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  sources() {
    return this.prisma.client.harvestSource.findMany({ orderBy: { name: 'asc' } });
  }

  offers(params: { stage?: string; market?: string; niche?: string }) {
    const where: Prisma.OfferWhereInput = {};
    if (params.stage) where.stage = params.stage as Prisma.EnumOfferStageFilter['equals'];
    if (params.market) where.market = params.market;
    if (params.niche) where.niche = params.niche;
    return this.prisma.client.offer.findMany({
      where,
      orderBy: [{ opportunityScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  trends() {
    return this.prisma.client.termTrend.findMany({ orderBy: { volumeMonthly: 'desc' } });
  }

  async setStage(id: string, body: OfferStageInput) {
    const offer = await this.prisma.client.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    return this.prisma.client.offer.update({ where: { id }, data: { stage: body.stage } });
  }

  // Re-enfileira o enriquecimento de uma oferta que falhou.
  async retryEnrichment(id: string) {
    const offer = await this.prisma.client.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    await this.prisma.client.offer.update({
      where: { id },
      data: { enrichment: 'pending', enrichmentError: null },
    });
    await this.queue.enrich.add('retry', { offerId: id });
    return { ok: true };
  }

  /**
   * Dispara a colheita. Uma rodada por fonte, enfileiradas em sequência — o worker
   * roda com concurrency 1 nessa fila para não competir consigo mesmo por rate
   * limit do urlscan.
   */
  async harvest(input: HarvestInput) {
    const sources = input.sourceId
      ? await this.prisma.client.harvestSource.findMany({ where: { id: input.sourceId } })
      : await this.prisma.client.harvestSource.findMany({ where: { enabled: true } });

    if (sources.length === 0) throw new NotFoundException('Nenhuma fonte habilitada');

    const runs = [];
    for (const source of sources) {
      const run = await this.prisma.client.ingestionRun.create({
        data: { query: source.query, sourceId: source.id, status: 'running' },
      });
      await this.queue.harvest.add('manual', { runId: run.id, sourceId: source.id });
      runs.push(run);
    }
    return runs;
  }

  runs() {
    return this.prisma.client.ingestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { source: { select: { name: true, kind: true } } },
    });
  }

  async run(id: string) {
    const run = await this.prisma.client.ingestionRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Rodada não encontrada');
    return run;
  }
}
