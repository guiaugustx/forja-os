import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

type Decision = 'pipeline' | 'analysis' | 'discard';

// Janela do desfazer. O enriquecimento entra atrasado para que uma decisão
// revertida nesse intervalo não gaste download nem token de LLM.
const UNDO_WINDOW_MS = 8_000;

// jobId determinístico do enrich de uma oferta. Formato com 3 segmentos porque
// o BullMQ só aceita ':' num jobId custom nesse padrão legado (compat com jobs
// repetíveis) — um jobId com um único ':' é rejeitado em runtime.
function enrichJobId(offerId: string): string {
  return `enrich:${offerId}:job`;
}

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Fila de triagem, paginada por cursor — a fila pode ter centenas de itens e a
   * tabela carrega por bloco.
   */
  async list(params: {
    status?: string;
    sourceId?: string;
    reason?: string;
    sort?: string;
    cursor?: string;
    take?: string;
  }) {
    const where: Prisma.CandidateWhereInput = {
      status: (params.status as Prisma.EnumCandidateStatusFilter['equals']) ?? 'pending',
    };
    if (params.sourceId) where.sourceId = params.sourceId;
    if (params.reason) where.discardReason = params.reason;

    const orderBy: Prisma.CandidateOrderByWithRelationInput[] =
      params.sort === 'days'
        ? [{ daysRunning: 'desc' }, { id: 'asc' }]
        : params.sort === 'recent'
          ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          : [{ hitCount: 'desc' }, { id: 'asc' }];

    const take = Math.min(Number(params.take ?? 50), 200);

    const items = await this.prisma.client.candidate.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: { source: { select: { id: true, name: true, kind: true } } },
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const total = await this.prisma.client.candidate.count({ where });

    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, total };
  }

  async triage(id: string, decision: Decision) {
    const candidate = await this.prisma.client.candidate.findUnique({
      where: { id },
      include: { source: true },
    });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    if (decision === 'discard') {
      return this.prisma.client.candidate.update({
        where: { id },
        data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
      });
    }

    const stage = decision === 'pipeline' ? 'pipeline' : 'analysis';

    const offer = await this.prisma.client.offer.create({
      data: {
        source: 'urlscan',
        candidateId: candidate.id,
        advertiser: candidate.domain,
        name: candidate.productName ?? candidate.title ?? candidate.domain,
        market: 'BR',
        niche: 'desconhecido',
        pageUrl: candidate.url,
        screenshotUrl: candidate.screenshotUrl,
        ticketEstCents: candidate.priceCents,
        detectedGateway: candidate.gateway,
        daysRunning: candidate.daysRunning,
        scanCount: candidate.hitCount,
        firstSeen: candidate.firstSeenAt,
        lastSeen: candidate.lastSeenAt,
        stage,
        enrichment: 'pending',
      },
    });

    await this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'promoted', triagedAt: new Date() },
    });

    // jobId determinístico: é o que permite ao desfazer cancelar o job.
    // Precisa de 2 dois-pontos (3 segmentos) — o BullMQ só aceita ':' no jobId
    // custom nesse formato legado de job repetível; com 1 só ele rejeita em runtime.
    await this.queue.enrich.add(
      'promote',
      { offerId: offer.id },
      { jobId: enrichJobId(offer.id), delay: UNDO_WINDOW_MS },
    );

    return offer;
  }

  async bulk(ids: string[], decision: Decision) {
    // Descarte em lote é uma única escrita — o caso comum é marcar dezenas de
    // linhas e matar todas de uma vez.
    if (decision === 'discard') {
      const res = await this.prisma.client.candidate.updateMany({
        where: { id: { in: ids }, status: 'pending' },
        data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
      });
      return { count: res.count };
    }

    let count = 0;
    for (const id of ids) {
      await this.triage(id, decision);
      count++;
    }
    return { count };
  }

  /** Desfaz uma decisão recente: devolve o candidato à fila e cancela o job atrasado. */
  async undo(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    if (candidate.offer) {
      const job = await this.queue.enrich.getJob(enrichJobId(candidate.offer.id));
      if (job) await job.remove().catch(() => undefined);
      await this.prisma.client.offer.delete({ where: { id: candidate.offer.id } });
    }

    return this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null, triagedAt: null },
    });
  }

  /** Traz de volta à fila algo que o pré-filtro descartou. */
  async restore(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');
    return this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null },
    });
  }
}
