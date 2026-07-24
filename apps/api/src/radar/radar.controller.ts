import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RadarService } from './radar.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ingestInputSchema,
  offerCurationSchema,
  type IngestInput,
  type OfferCuration,
} from './radar.dto';

@Controller('radar')
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  @Get('offers')
  offers(
    @Query('market') market?: string,
    @Query('niche') niche?: string,
    @Query('saved') saved?: string,
  ) {
    return this.radar.offers({ market, niche, saved });
  }

  @Get('trends')
  trends() {
    return this.radar.trends();
  }

  @Get('shortlist')
  shortlist() {
    return this.radar.shortlist();
  }

  @Post('ingest')
  ingest(@Body(new ZodValidationPipe(ingestInputSchema)) body: IngestInput) {
    return this.radar.ingest(body);
  }

  @Get('runs')
  runs() {
    return this.radar.runs();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.radar.run(id);
  }

  @Patch('offers/:id')
  setSaved(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(offerCurationSchema)) body: OfferCuration,
  ) {
    return this.radar.setSaved(id, body.saved);
  }
}
