import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserInput } from './auth.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // Cria o admin inicial a partir do .env (ADMIN_EMAIL/ADMIN_PASSWORD), se não existir.
  // Tolerante a falha (ex.: tabela User ainda não migrada) para não derrubar o boot.
  async onModuleInit() {
    try {
      const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const password = process.env.ADMIN_PASSWORD;
      if (!email || !password) return;
      const existing = await this.prisma.client.user.findUnique({ where: { email } });
      if (existing) return;
      await this.prisma.client.user.create({
        data: { email, passwordHash: await bcrypt.hash(password, 10), name: 'Admin', role: 'admin' },
      });
      this.logger.log(`Admin inicial criado: ${email}`);
    } catch (e) {
      this.logger.warn(`Admin inicial não criado agora: ${(e as Error).message}`);
    }
  }

  private toPublic(u: { id: string; email: string; name: string | null; role: string }) {
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.client.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    return { token, user: this.toPublic(user) };
  }

  async me(userId: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    return this.toPublic(user);
  }

  async createUser(input: CreateUserInput) {
    const email = input.email.toLowerCase();
    const exists = await this.prisma.client.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Já existe um usuário com este e-mail');
    const user = await this.prisma.client.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(input.password, 10),
        name: input.name ?? null,
        role: input.role ?? 'member',
      },
    });
    return this.toPublic(user);
  }

  listUsers() {
    return this.prisma.client.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }
}
