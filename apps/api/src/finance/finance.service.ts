import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  balances() {
    return this.prisma.client.gatewayBalance.findMany();
  }

  transactions(productId?: string) {
    return this.prisma.client.transaction.findMany({
      where: productId ? { productId } : undefined,
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });
  }

  async summary() {
    const balances = await this.prisma.client.gatewayBalance.findMany();
    const products = await this.prisma.client.product.findMany({ select: { stage: true } });
    return {
      balances,
      activeProducts: products.filter((p) => p.stage === 'scaling').length,
      pipelineProducts: products.length,
    };
  }
}
