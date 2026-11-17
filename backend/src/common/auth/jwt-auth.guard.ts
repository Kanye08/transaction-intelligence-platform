import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { AppConfig, CONFIG_TOKEN } from '../../config/configuration';
import { AuthUser, JwtPayload } from './auth-user';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Applied globally (see AuthModule). Every route is protected unless it is
 * explicitly marked @Public(), so a new endpoint is secure by default rather
 * than secure only if the author remembered a decorator.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.auth.jwtSecret,
      });
    } catch {
      // Deliberately uniform: expired, malformed and forged tokens look alike.
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload.sub || !payload.org) {
      throw new UnauthorizedException('Invalid token payload');
    }

    request.user = {
      userId: payload.sub,
      organisationId: payload.org,
      email: payload.email,
      role: payload.role,
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
  }
}
