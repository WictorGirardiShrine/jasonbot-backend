import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { AuthUser } from '../types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) throw new Error('CurrentUser used without JwtAuthGuard');
    return req.user;
  },
);
