import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { STEP_KEYS, type DraftContext, type GeneratorStepKey } from '@forja/ai';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class OfferDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async create(input: { sourceOfferId?: string }) {
    const data: Prisma.OfferDraftCreateInput = { currentStep: 0 };

    if (input.sourceOfferId) {
      const offer = await this.prisma.client.offer.findUnique({ where: { id: input.sourceOfferId } });
      if (!offer) throw new NotFoundException('Oferta base não encontrada');
      data.sourceOffer = { connect: { id: offer.id } };
      const base: Record<string, unknown> = {};
      if (offer.pageUrl) base.salesPageUrl = offer.pageUrl;
      if (offer.xray) base.xray = offer.xray;
      data.base = base as Prisma.InputJsonValue;
    }

    return this.prisma.client.offerDraft.create({ data });
  }

  // Board da esteira: cada draft com o mínimo da oferta de origem para render.
  findAll() {
    return this.prisma.client.offerDraft.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        sourceOffer: {
          select: { id: true, name: true, advertiser: true, screenshotUrl: true, opportunityScore: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const draft = await this.prisma.client.offerDraft.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException('Draft não encontrado');
    return draft;
  }

  private toContext(draft: {
    base: Prisma.JsonValue | null;
    avatar: Prisma.JsonValue | null;
    bigIdea: Prisma.JsonValue | null;
    stack: Prisma.JsonValue | null;
    salesCopy: Prisma.JsonValue | null;
  }): DraftContext {
    return {
      base: (draft.base as DraftContext['base']) ?? undefined,
      avatar: (draft.avatar as DraftContext['avatar']) ?? undefined,
      bigIdea: (draft.bigIdea as DraftContext['bigIdea']) ?? undefined,
      stack: (draft.stack as DraftContext['stack']) ?? undefined,
      salesCopy: (draft.salesCopy as DraftContext['salesCopy']) ?? undefined,
    };
  }

  // Salva os dados de uma etapa (edição manual) e avança o progresso (híbrido).
  async patchStep(id: string, step: GeneratorStepKey, data: unknown) {
    const draft = await this.findOne(id);
    const idx = STEP_KEYS.indexOf(step);
    const payload: Record<string, unknown> = { [step]: (data ?? {}) as Prisma.InputJsonValue };
    if (idx + 1 > draft.currentStep) payload.currentStep = idx + 1;
    return this.prisma.client.offerDraft.update({
      where: { id },
      data: payload as Prisma.OfferDraftUpdateInput,
    });
  }

  // Gera uma etapa com IA usando o contexto acumulado e persiste o resultado.
  async generate(id: string, step: GeneratorStepKey) {
    const draft = await this.findOne(id);
    const result = await this.ai.generateStep(step, this.toContext(draft));

    const idx = STEP_KEYS.indexOf(step);
    const payload: Record<string, unknown> = { [step]: result as unknown as Prisma.InputJsonValue };
    if (idx + 1 > draft.currentStep) payload.currentStep = idx + 1;

    const saved = await this.prisma.client.offerDraft.update({
      where: { id },
      data: payload as Prisma.OfferDraftUpdateInput,
    });
    return { step, result, draft: saved };
  }
}
