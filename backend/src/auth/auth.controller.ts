import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { Public } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';

const MAX_EMAIL_LENGTH = 254;
/** bcrypt only uses the first 72 bytes; anything far beyond is abuse, not a password. */
const MAX_PASSWORD_LENGTH = 200;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { email, password } = parseCredentials(body);
    const result = await this.auth.login(email, password, request.ip ?? 'unknown');

    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        response.setHeader('Retry-After', String(result.retryAfterSeconds));
        throw new HttpException(
          `Too many failed attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minute(s).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // Same message for unknown email and wrong password.
      throw new UnauthorizedException('Invalid email or password');
    }

    response.cookie(this.config.auth.cookieName, result.token, this.cookieOptions());
    return { user: result.user };
  }

  /** Public so an expired session can still be cleared; it only removes the cookie. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    response.clearCookie(this.config.auth.cookieName, options);
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    const { email, role } = request.user!;
    return { user: { email, role }, authDisabled: this.config.auth.authDisabled };
  }

  private cookieOptions(): CookieOptions {
    const { cookieSameSite, cookieSecure, sessionHours } = this.config.auth;
    return {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: '/',
      maxAge: sessionHours * 3_600_000,
    };
  }
}

function parseCredentials(body: unknown): { email: string; password: string } {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new BadRequestException('email and password are required');
  }
  if (!email.trim() || !password) {
    throw new BadRequestException('email and password are required');
  }
  if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException('email or password is too long');
  }
  return { email: email.trim(), password };
}
