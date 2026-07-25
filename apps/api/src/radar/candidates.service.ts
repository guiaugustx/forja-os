import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { CandidateListQuery } from './radar.dto';

type Decision = 'pipeline' | 'analysis' | 'discard';

// Janela do desfazer. O enriquecimento entra atrasado para que uma decisão
// revertida nesse intervalo não gaste download nem token de LLM.
const UNDO_WINDOW_MS = 8_000;

// Folga sobre a janela de desfazer nominal: o botão "desfazer" da UI some depois
// de UNDO_WINDOW_MS, mas o request ainda precisa viajar rede + fila até chegar
// aqui. Sem essa folga, um desfazer clicado no último instante da janela visível
// já chegaria "atrasado" no servidor e seria recusado sem necessidade.
const UNDO_GRACE_MS = 2_000;

// jobId determinístico do enrich de uma oferta. Sem ':' — o BullMQ 5.81 tolera
// ':' apenas com exatamente 3 segmentos por compat legado (o próprio código da
// lib marca isso como TODO para remoção num major futuro), então evitamos
// depender dessa muleta e usamos hífen.
function enrichJobId(offerId: string): string {
  return `enrich-${offerId}`;
}

const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Fila de triagem, paginada por cursor — a fila pode ter centenas de itens e a
   * tabela carrega por bloco. `params` já chega validado pelo ZodValidationPipe
   * (candidateListQuerySchema): take é inteiro 1-200 com default, status é um
   * CandidateStatus válido.
   */
  async list(params: CandidateListQuery) {
    const where: Prisma.CandidateWhereInput = { status: params.status };
    if (params.sourceId) where.sourceId = params.sourceId;
    if (params.reason) where.discardReason = params.reason;

    const orderBy: Prisma.CandidateOrderByWithRelationInput[] =
      params.sort === 'days'
        ? [{ daysRunning: 'desc' }, { id: 'asc' }]
        : params.sort === 'recent'
          ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          : [{ hitCount: 'desc' }, { id: 'asc' }];

    const take = params.take;

    let items;
    try {
      items = await this.prisma.client.candidate.findMany({
        where,
        orderBy,
        take: take + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
        include: { source: { select: { id: true, name: true, kind: true } } },
      });
    } catch (err) {
      // Cursor apontando pra um id que não existe (mais) faz o Prisma lançar
      // P2025 — devolvemos 400 legível em vez do 500 cru.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new BadRequestException('Cursor inválido ou expirado');
      }
      throw err;
    }

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

    // Sem essa checagem, chamar PATCH duas vezes (ou o item 7 de um lote que já
    // foi processado por outra aba) tenta criar uma segunda Offer para o mesmo
    // candidato e esbarra no candidateId @unique — 500 opaco em vez de um 409
    // dizendo o que já aconteceu.
    if (candidate.status !== 'pending') {
      throw new ConflictException(
        `Candidato já foi triado (status atual: ${candidate.status}); recarregue a lista antes de tentar de novo.`,
      );
    }

    if (decision === 'discard') {
      return this.prisma.client.candidate.update({
        where: { id },
        data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
      });
    }

    const stage = decision === 'pipeline' ? 'pipeline' : 'analysis';

    let offer;
    try {
      // Offer.create + Candidate.update precisam ser atômicos: se o update
      // falhasse depois do create (fora de transação), sobrava uma Offer órfã
      // com o candidato ainda pending, e a próxima promoção esbarrava no
      // candidateId @unique.
      offer = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.offer.create({
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

        await tx.candidate.update({
          where: { id },
          data: { status: 'promoted', triagedAt: new Date() },
        });

        return created;
      });
    } catch (err) {
      // @@unique([source, pageUrl]) — dois candidatos distintos com a mesma
      // pageUrl (mesma página de vendas achada duas vezes) colidem aqui. 409
      // legível em vez do 500 cru do Prisma.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException(
          'Já existe uma oferta para essa mesma página de vendas (outro candidato com a mesma URL já foi promovido).',
        );
      }
      throw err;
    }

    // Enfileirar fica fora da transação de propósito: se o enqueue falhar, a
    // Offer já existe no banco e precisa aparecer com "tentar de novo" — não
    // pode ficar presa em enrichment=pending sem job nenhum. Foi exatamente
    // essa falha (bug do jobId do BullMQ) que aconteceu durante a verificação.
    try {
      await this.queue.enrich.add(
        'promote',
        { offerId: offer.id },
        { jobId: enrichJobId(offer.id), delay: UNDO_WINDOW_MS },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enfileirar enrich da oferta ${offer.id}: ${message}`);
      offer = await this.prisma.client.offer.update({
        where: { id: offer.id },
        data: { enrichment: 'failed', enrichmentError: message },
      });
    }

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

    // Promoção em lote não pode abortar no meio: um id inválido no item 7 de 40
    // não pode deixar os 33 restantes intocados e o cliente sem saber onde
    // parou. Coleta o que funcionou e o que falhou, com motivo, para a UI poder
    // mostrar "38 promovidos, 2 falharam" em vez de recarregar às cegas.
    const succeeded: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await this.triage(id, decision);
        succeeded.push(id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Erro desconhecido';
        failed.push({ id, reason });
      }
    }
    return { count: succeeded.length, succeeded, failed };
  }

  /** Desfaz uma decisão recente: devolve o candidato à fila e cancela o job atrasado. */
  async undo(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({
      where: { id },
      include: { offer: { include: { drafts: true } } },
    });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    if (candidate.status !== 'promoted' || !candidate.offer) {
      throw new ConflictException('Só é possível desfazer um candidato recém-promovido.');
    }

    // O botão "desfazer" da UI some poucos segundos depois da promoção, mas a
    // rota em si não tinha nenhuma trava — aceitava desfazer dias depois e
    // apagava a Offer em silêncio (as relações de Opportunity.offerId e
    // OfferDraft.sourceOfferId são opcionais, então o Prisma não bloqueia).
    // A janela aqui usa a mesma constante que atrasa o job de enrich, mais uma
    // folga pequena (UNDO_GRACE_MS) para cobrir o tempo de rede do próprio
    // request de desfazer — não é uma trava de segurança, é para não recusar
    // um clique legítimo feito no último instante em que o botão ainda existia.
    const elapsedMs = candidate.triagedAt ? Date.now() - candidate.triagedAt.getTime() : Infinity;
    if (elapsedMs > UNDO_WINDOW_MS + UNDO_GRACE_MS) {
      throw new ConflictException(
        'Janela de desfazer expirada. Para remover essa oferta agora, descarte-a pela fila de Análise.',
      );
    }

    // Se já existe rascunho de modelagem derivado dessa oferta, desfazer
    // destruiria trabalho manual/IA já feito em cima dela — recusa em vez de
    // apagar silenciosamente.
    if (candidate.offer.drafts.length > 0) {
      throw new ConflictException(
        'Essa oferta já tem rascunho de modelagem gerado; desfazer destruiria esse trabalho. Descarte pela fila de Análise em vez disso.',
      );
    }

    const job = await this.queue.enrich.getJob(enrichJobId(candidate.offer.id));
    let jobRemovalWarning: string | undefined;
    if (job) {
      try {
        await job.remove();
      } catch (err) {
        // Não engolir: se o job já está ativo, remove() lança, e isso significa
        // que o enriquecimento pode já estar rodando e gastando IA — exatamente
        // o que a janela de desfazer existe para evitar. O humano precisa saber.
        const message = err instanceof Error ? err.message : String(err);
        jobRemovalWarning = `Não foi possível cancelar o job de enriquecimento (pode já estar em andamento): ${message}`;
        this.logger.warn(jobRemovalWarning);
      }
    }

    await this.prisma.client.offer.delete({ where: { id: candidate.offer.id } });

    const updated = await this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null, triagedAt: null },
    });

    return jobRemovalWarning ? { ...updated, warning: jobRemovalWarning } : updated;
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
