import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { OfferDraftsService } from './offer-drafts.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createDraftSchema,
  generateSchema,
  patchStepSchema,
  type CreateDraftInput,
  type GenerateInput,
  type PatchStepInput,
} from './offer-drafts.dto';

@Controller('offer-drafts')
export class OfferDraftsController {
  constructor(private readonly drafts: OfferDraftsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createDraftSchema)) body: CreateDraftInput) {
    return this.drafts.create(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.drafts.findOne(id);
  }

  @Patch(':id/step')
  patchStep(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchStepSchema)) body: PatchStepInput,
  ) {
    return this.drafts.patchStep(id, body.step, body.data);
  }

  @Post(':id/generate')
  generate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(generateSchema)) body: GenerateInput,
  ) {
    return this.drafts.generate(id, body.step);
  }
}
