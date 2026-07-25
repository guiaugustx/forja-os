import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { HarvestInput, OfferStageInput, UpdateSourceInput } from './radar.dto';
import { enrichJobId } from './enrich-job';

@Injectable()
export class RadarService {
  private readonly logger = new Logger(RadarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  sources() {
    return this.prisma.client.harvestSource.findMany({ orderBy: { name: 'asc' } });
  }

  // Correção 2: rota que o spec previa e nunca chegou a existir — calibrar
  // minHitCount/maxAgeDays (e ligar/desligar uma fonte) exigia UPDATE manual
  // no Postgres. `findUnique` antes do `update` é o que devolve 404 legível em
  // vez do P2025 cru do Prisma quando o id não existe.
  async updateSource(id: string, body: UpdateSourceInput) {
    const source = await this.prisma.client.harvestSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Fonte não encontrada');
    return this.prisma.client.harvestSource.update({ where: { id }, data: body });
  }

  // Correção 7: sem teto, a esteira e a fila de Análise cresceriam pra sempre —
  // 300 é folgado o bastante para o volume de itens *promovidos* (que já
  // passaram pela triagem humana, não o pool bruto de milhares) sem virar
  // rolagem infinita. `id: 'desc'` no fim garante ordenação estável mesmo
  // quando duas ofertas empatam em score e em createdAt (ex.: mesma
  // transação de seed).
  offers(params: { stage?: string; market?: string; niche?: string }) {
    const where: Prisma.OfferWhereInput = {};
    if (params.stage) where.stage = params.stage as Prisma.EnumOfferStageFilter['equals'];
    if (params.market) where.market = params.market;
    if (params.niche) where.niche = params.niche;
    return this.prisma.client.offer.findMany({
      where,
      orderBy: [
        { opportunityScore: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 300,
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

    // Mesmo jobId determinístico da triagem (helper compartilhado) — assim o
    // "tentar de novo" também fica localizável e cancelável pelo desfazer, e
    // clicar duas vezes seguidas não cria dois jobs concorrentes pra mesma
    // oferta. O BullMQ recusa add() com um id que já existe no Redis mesmo
    // concluído, então remove o job anterior antes de enfileirar o novo.
    const jobId = enrichJobId(id);
    const existing = await this.queue.enrich.getJob(jobId);
    if (existing) {
      try {
        await existing.remove();
      } catch (err) {
        // Essa remoção falha tanto quando o job anterior está mesmo em
        // andamento (worker segurando o lock) quanto por qualquer outra causa
        // (Redis fora do ar, timeout de rede) — não dá pra distinguir os dois
        // casos daqui, então não afirmamos uma causa específica pro cliente.
        // A mensagem crua do BullMQ (em inglês, com o nome interno do job) só
        // vai pro log; é a mesma classe de vazamento já removida do bulk().
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Falha ao remover job de enriquecimento ${jobId} antes do retry: ${message}`,
        );
        throw new ConflictException(
          'Não foi possível reiniciar o enriquecimento agora; tente novamente em instantes.',
        );
      }
    }

    // Só mexe no estado da oferta depois de confirmar que o enfileiramento
    // deu certo — antes disso, um "pending" prematuro que topasse com Redis
    // fora do ar deixava a oferta sem mensagem de erro e sem job nenhum, pra
    // sempre. Trata a falha do add() do mesmo jeito que triage() trata:
    // oferta cai em 'failed' com a mensagem, pra o card continuar oferecendo
    // "tentar de novo" em vez de ficar presa em 'pending'.
    try {
      await this.queue.enrich.add('retry', { offerId: id }, { jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enfileirar retry de enrich da oferta ${id}: ${message}`);
      await this.prisma.client.offer.update({
        where: { id },
        data: { enrichment: 'failed', enrichmentError: message },
      });
      return { ok: false };
    }

    await this.prisma.client.offer.update({
      where: { id },
      data: { enrichment: 'pending', enrichmentError: null },
    });
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

    // Cria todas as rodadas antes de enfileirar qualquer job: se a criação da
    // segunda IngestionRun falhasse no meio do laço anterior, a primeira já
    // tinha sido enfileirada e ia rodar mesmo com o cliente recebendo 500 — a
    // resposta mentia sobre o que foi de fato disparado.
    const runs = [];
    for (const source of sources) {
      const run = await this.prisma.client.ingestionRun.create({
        data: { query: source.query, sourceId: source.id, status: 'running' },
      });
      runs.push({ run, sourceId: source.id });
    }

    for (const { run, sourceId } of runs) {
      await this.queue.harvest.add('manual', { runId: run.id, sourceId });
    }

    return runs.map(({ run }) => run);
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
