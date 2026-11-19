import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AuthUser } from './auth-user';

/** The authenticated principal. Its organisation id is the only tenant id we trust. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!request.user) {
    throw new UnauthorizedException('Authentication required');
  }
  return request.user;
});
