import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthUser } from './auth-user';

/**
 * Injects the authenticated principal. The organisation id on it is the only
 * tenant identifier the application trusts.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!request.user) {
    throw new UnauthorizedException('Authentication required');
  }
  return request.user;
});
