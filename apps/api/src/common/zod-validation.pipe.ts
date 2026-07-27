import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

// Pipe de validação com Zod, usado por corpo/param/query string: @Body(new ZodValidationPipe(schema)).
export class ZodValidationPipe<T> implements PipeTransform {
  // Input `unknown` de propósito: schemas com .default()/.transform() têm tipo
  // de entrada diferente do de saída, e o pipe só se importa com o que SAI.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validação falhou',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
