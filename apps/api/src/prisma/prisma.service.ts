import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma } from '@forja/db';

@Injectable()
export class PrismaService implements OnModuleInit {
  readonly client = prisma;
  async onModuleInit() {
    await this.client.$connect();
  }
}
