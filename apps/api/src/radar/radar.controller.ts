import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RadarService } from './radar.service';
import { CandidatesService } from './candidates.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  harvestInputSchema,
  triageDecisionSchema,
  bulkTriageSchema,
  offerStageSchema,
  candidateListQuerySchema,
  updateSourceSchema,
  type HarvestInput,
  type TriageDecision,
  type BulkTriage,
  type OfferStageInput,
  type CandidateListQuery,
  type UpdateSourceInput,
} from './radar.dto';

@Controller('radar')
export class RadarController {
  constructor(
    private readonly radar: RadarService,
    private readonly candidates: CandidatesService,
  ) {}

  // ===== fontes e colheita =====

  @Get('sources')
  sources() {
    return this.radar.sources();
  }

  @Patch('sources/:id')
  updateSource(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSourceSchema)) body: UpdateSourceInput,
  ) {
    return this.radar.updateSource(id, body);
  }

  @Post('harvest')
  harvest(@Body(new ZodValidationPipe(harvestInputSchema)) body: HarvestInput) {
    return this.radar.harvest(body);
  }

  @Get('runs')
  runs() {
    return this.radar.runs();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.radar.run(id);
  }

  // ===== triagem =====

  @Get('candidates')
  list(@Query(new ZodValidationPipe(candidateListQuerySchema)) query: CandidateListQuery) {
    return this.candidates.list(query);
  }

  @Patch('candidates/:id')
  triage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(triageDecisionSchema)) body: TriageDecision,
  ) {
    return this.candidates.triage(id, body.decision);
  }

  @Post('candidates/bulk')
  bulk(@Body(new ZodValidationPipe(bulkTriageSchema)) body: BulkTriage) {
    return this.candidates.bulk(body.ids, body.decision);
  }

  @Post('candidates/:id/undo')
  undo(@Param('id') id: string) {
    return this.candidates.undo(id);
  }

  @Post('candidates/:id/restore')
  restore(@Param('id') id: string) {
    return this.candidates.restore(id);
  }

  // ===== ofertas =====

  @Get('offers')
  offers(
    @Query('stage') stage?: string,
    @Query('market') market?: string,
    @Query('niche') niche?: string,
  ) {
    return this.radar.offers({ stage, market, niche });
  }

  @Patch('offers/:id')
  setStage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(offerStageSchema)) body: OfferStageInput,
  ) {
    return this.radar.setStage(id, body);
  }

  @Post('offers/:id/retry-enrichment')
  retry(@Param('id') id: string) {
    return this.radar.retryEnrichment(id);
  }

  @Get('trends')
  trends() {
    return this.radar.trends();
  }
}
