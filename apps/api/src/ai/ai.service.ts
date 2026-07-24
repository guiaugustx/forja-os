import { Injectable } from '@nestjs/common';
import { generateStep, type DraftContext, type GeneratedBlock, type GeneratorStepKey } from '@forja/ai';

/**
 * Serviço de IA — centraliza a geração das etapas do gerador de ofertas.
 * Usa o SiliconFlow (Qwen) via pacote compartilhado @forja/ai. Os prompts são
 * versionados por tipo de asset e sempre alimentados pelo contexto acumulado.
 */
@Injectable()
export class AiService {
  generateStep(step: GeneratorStepKey, draft: DraftContext): Promise<GeneratedBlock> {
    return generateStep(step, draft);
  }
}
