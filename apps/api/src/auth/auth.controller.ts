import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CurrentUser, type JwtUser } from './current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { loginSchema, createUserSchema, type LoginInput, type CreateUserInput } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }

  @Get('users')
  listUsers(@CurrentUser() user: JwtUser) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas admin pode listar usuários');
    return this.auth.listUsers();
  }

  @Post('users')
  createUser(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas admin pode criar usuários');
    return this.auth.createUser(body);
  }
}
