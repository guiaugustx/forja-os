import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.client.product.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { creatives: true, deliverables: true } } },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.client.product.findUnique({
      where: { id },
      include: { deliverables: true, funnels: { include: { steps: true } }, creatives: true, campaigns: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }

  create(data: { name: string; market: string; priceCents?: number; gateway?: string }) {
    return this.prisma.client.product.create({ data });
  }
}
