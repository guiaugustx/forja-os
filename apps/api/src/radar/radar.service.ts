import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { IngestInput } from './radar.dto';

@Injectable()
export class RadarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  offers(params: { market?: string; niche?: string; saved?: string }) {
    const where: Prisma.OfferWhereInput = {};
    if (params.market) where.market = params.market;
    if (params.niche) where.niche = params.niche;
    if (params.saved === 'true') where.saved = true;
    return this.prisma.client.offer.findMany({
      where,
      orderBy: [{ opportunityScore: { sort: 'desc', nulls: 'last' } }, { daysRunning: 'desc' }],
    });
  }

  trends() {
    return this.prisma.client.termTrend.findMany({ orderBy: { volumeMonthly: 'desc' } });
  }

  // Shortlist = ofertas salvas pela curadoria, ordenadas por score.
  shortlist() {
    return this.prisma.client.offer.findMany({
      where: { saved: true },
      orderBy: [{ opportunityScore: { sort: 'desc', nulls: 'last' } }],
    });
  }

  async setSaved(id: string, saved: boolean) {
    const offer = await this.prisma.client.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    return this.prisma.client.offer.update({ where: { id }, data: { saved } });
  }

  // Dispara uma rodada de ingestão: registra a run e enfileira o job no worker.
  async ingest(input: IngestInput) {
    const query = input.query || process.env.URLSCAN_QUERY || 'domain:cdn.utmify.com.br';
    const run = await this.prisma.client.ingestionRun.create({ data: { query, status: 'running' } });
    await this.queue.ingestOffers.add('manual', {
      runId: run.id,
      query,
      lookbackDays: input.lookbackDays,
      max: input.max,
    });
    return run;
  }

  runs() {
    return this.prisma.client.ingestionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
  }

  async run(id: string) {
    const run = await this.prisma.client.ingestionRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Rodada não encontrada');
    return run;
  }
}
