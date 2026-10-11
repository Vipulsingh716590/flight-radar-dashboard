import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { Role, SessionUser } from './auth.types.js';

export type AuthenticatedRequest = Request & { user?: SessionUser };

/**
 * Registered globally: every route needs a valid session cookie unless it is
 * marked `@Public()`. `@Roles()` further restricts a route to given roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[this.config.auth.cookieName];
    const user = token ? await this.auth.verifyToken(token) : null;
    if (!user) throw new UnauthorizedException('Authentication required');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');

    request.user = user;
    return true;
  }
}
