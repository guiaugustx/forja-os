import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { CandidateListQuery } from './radar.dto';
import { enrichJobId } from './enrich-job';

type Decision = 'pipeline' | 'analysis' | 'discard';

// Atraso do job de enrich. Existe para dar tempo do desfazer cancelar o job
// antes que ele comece a gastar download/IA — mas quem decide se o desfazer
// ainda é seguro é o estado real do job no Redis (ver `undo()`), não o
// relógio: um relógio só promete um número, o job pode ficar elegível para
// processar antes ou depois dele por variação de carga do worker.
const UNDO_WINDOW_MS = 8_000;

const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

// err.meta.target de um P2002 varia de formato entre providers do Prisma (às
// vezes array de colunas, às vezes o nome do índice/constraint como string) —
// normaliza pra uma string e testa "contém", em vez de assumir um formato só.
function targetIncludes(target: unknown, column: string): boolean {
  const str = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return str.includes(column);
}

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

    let items;
    try {
      items = await this.prisma.client.candidate.findMany({
        where,
        orderBy,
        take: params.take + 1,
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

    const hasMore = items.length > params.take;
    const page = hasMore ? items.slice(0, params.take) : items;
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
      // Offer tem duas constraints únicas e a checagem de status acima é TOCTOU:
      // dois PATCH concorrentes no mesmo candidato passam ambos pela checagem
      // (nenhum viu o outro ainda), e o segundo estoura aqui por candidateId —
      // não por pageUrl duplicada. Sem distinguir as duas, o operador recebia
      // sempre a mensagem de "página de vendas duplicada" e ia procurar uma
      // duplicata que não existe, quando o certo era só recarregar a lista.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_CONSTRAINT) {
        if (targetIncludes(err.meta?.target, 'candidateId')) {
          throw new ConflictException(
            'Esse candidato acabou de ser triado por outra requisição; recarregue a lista antes de tentar de novo.',
          );
        }
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
    // A tela de triagem (ainda a ser escrita) trata as duas decisões com o
    // mesmo componente — se descarte devolvesse só {count} e promoção
    // devolvesse {count, succeeded, failed}, o cliente teria que tratar
    // `failed` como possivelmente ausente conforme a decisão enviada. As duas
    // ramificações abaixo sempre devolvem a mesma forma.
    if (decision === 'discard') {
      // Descarte em lote continua sendo (no essencial) uma única escrita —
      // mas para saber quais ids de fato viraram discarded_manual (e quais já
      // não estavam mais pending) é preciso ler antes de escrever. Ler e
      // escrever numa transação, com o `status: 'pending'` mantido também no
      // `where` da escrita, é o que garante a guarda: se um PATCH promover um
      // desses ids entre a leitura e a escrita, a updateMany simplesmente não
      // toca nessa linha — sem essa guarda, o candidato promovido (já com
      // Offer criada) seria sobrescrito para discarded_manual, deixando a
      // Offer órfã e o item sem saída (undo exige 'promoted', triage exige
      // 'pending'; só restore() resolveria, e não é a rota que a UI oferece
      // aqui).
      const succeeded = await this.prisma.client.$transaction(async (tx) => {
        const eligible = await tx.candidate.findMany({
          where: { id: { in: ids }, status: 'pending' },
          select: { id: true },
        });
        const eligibleIds = eligible.map((c) => c.id);
        if (eligibleIds.length === 0) return [];

        const res = await tx.candidate.updateMany({
          where: { id: { in: eligibleIds }, status: 'pending' },
          data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
        });

        // Caminho comum: nada mudou de status entre a leitura e a escrita, e
        // res.count bate com eligibleIds. Só se alguém promoveu um desses ids
        // nesse meio-tempo (res.count menor) é que vale a pena reconsultar
        // para saber exatamente quais ids a escrita de fato tocou — a
        // resposta não pode contar como "sucesso" um id que a guarda barrou.
        if (res.count === eligibleIds.length) return eligibleIds;
        const actuallyDiscarded = await tx.candidate.findMany({
          where: { id: { in: eligibleIds }, status: 'discarded_manual' },
          select: { id: true },
        });
        return actuallyDiscarded.map((c) => c.id);
      });

      const succeededSet = new Set(succeeded);
      const failed = ids
        .filter((id) => !succeededSet.has(id))
        .map((id) => ({ id, reason: 'Candidato não encontrado ou já triado' }));
      return { count: succeeded.length, succeeded, failed };
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
        // Só captura falha legítima de item — as exceções HTTP que o Nest
        // usa para recusar uma única linha (409 de já triado, 404 de id
        // inexistente etc). Qualquer outra coisa é falha de infraestrutura
        // (Postgres/Redis fora do ar): com 40 ids isso viraria silenciosamente
        // "count: 0" com 201, escondendo um 5xx real e vazando a mensagem
        // crua do driver pro cliente. Relança para aparecer como erro de
        // servidor de verdade.
        if (!(err instanceof HttpException)) throw err;
        failed.push({ id, reason: err.message });
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
    const offer = candidate.offer;

    // Se já existe rascunho de modelagem derivado dessa oferta, desfazer
    // destruiria trabalho manual/IA já feito em cima dela — recusa em vez de
    // apagar silenciosamente.
    if (offer.drafts.length > 0) {
      throw new ConflictException(
        'Essa oferta já tem rascunho de modelagem gerado; desfazer destruiria esse trabalho. Descarte pela fila de Análise em vez disso.',
      );
    }

    // O botão "desfazer" da UI some poucos segundos depois da promoção, mas um
    // relógio sozinho não é confiável pra decidir se ainda é seguro: o job de
    // enrich entra atrasado (UNDO_WINDOW_MS), não numa data-limite, então o que
    // sustenta a promessa de "ainda dá pra desfazer" é o estado real do job no
    // Redis, não quanto tempo passou. Antes disso ficar assim: entre
    // UNDO_WINDOW_MS e a folga que existia aqui, o job já podia estar elegível
    // pra rodar — se estivesse ativo, a Offer era apagada mesmo com o worker
    // escrevendo nela; se já tivesse concluído, sumia em silêncio a IA já gasta.
    const job = await this.queue.enrich.getJob(enrichJobId(offer.id));
    if (job) {
      const state = await job.getState();
      const stillPending = state === 'waiting' || state === 'delayed';

      // Correção 5: uma oferta em `enrichment: 'failed'` não tem dossiê nenhum
      // para perder — o job pode ter estourado antes mesmo de chamar a IA (ex.:
      // a chave devolvendo 403 por falta de crédito), e mesmo quando chegou a
      // chamar, não sobrou nada aproveitável. Não há gasto a proteger, então
      // não recusamos por causa do estado do job nesse caso — só quando ele
      // ainda está para rodar (`stillPending`) é que existe algo a cancelar.
      if (!stillPending && offer.enrichment !== 'failed') {
        throw new ConflictException(
          'O enriquecimento dessa oferta já concluiu (ou está em andamento); não é mais seguro desfazer automaticamente. Descarte pela fila de Análise.',
        );
      }

      if (stillPending) {
        try {
          await job.remove();
        } catch (err) {
          // Perdeu a corrida entre checar o estado e remover — o worker pegou o
          // job exatamente nesse intervalo. Recusa em vez de apagar a Offer
          // embaixo de um enriquecimento que pode já estar rodando.
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Corrida ao cancelar job de enriquecimento da oferta ${offer.id}: ${message}`,
          );
          throw new ConflictException(
            'Não foi possível cancelar o enriquecimento a tempo; ele pode já estar em andamento. Descarte pela fila de Análise.',
          );
        }
      }
    }
    // job ausente: só acontece quando o enfileiramento falhou na própria
    // promoção (enrichment já registrado como 'failed') — nenhuma IA foi
    // gasta, então não há nada a cancelar e o desfazer é sempre seguro.

    // offer.delete + candidate.update precisam ser atômicos pela mesma razão
    // que em triage(): se o update falhasse depois do delete, o candidato
    // ficava "promoted" sem Offer — undo() devolveria 409 (sem oferta) e
    // triage() devolveria 409 (status não é pending), travado sem saída a não
    // ser restore(), que não é a rota que a UI oferece nesse contexto.
    return this.prisma.client.$transaction(async (tx) => {
      await tx.offer.delete({ where: { id: offer.id } });
      return tx.candidate.update({
        where: { id },
        data: { status: 'pending', discardReason: null, triagedAt: null },
      });
    });
  }

  /** Traz de volta à fila algo que foi descartado — pelo filtro ou à mão. */
  async restore(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    // Correção 6: sem essa guarda, restaurar um `promoted` devolveria o
    // candidato a `pending` com a `Offer` ainda viva — a próxima promoção
    // estouraria a violação de unicidade de `candidateId` para sempre, porque
    // nada além de SQL manual desfaria isso. A rota é pública mesmo sem botão
    // na tela hoje, então a guarda protege de qualquer cliente, não só da UI.
    if (candidate.status !== 'discarded_auto' && candidate.status !== 'discarded_manual') {
      throw new ConflictException(
        `Só é possível restaurar um candidato descartado (status atual: ${candidate.status}).`,
      );
    }

    return this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null, triagedAt: null },
    });
  }
}
