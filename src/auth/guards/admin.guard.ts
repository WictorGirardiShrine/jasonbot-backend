import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException('Not authenticated');
    const allowlist = this.config.getOrThrow<string[]>('ADMIN_EMAILS');
    if (!allowlist.includes(req.user.email)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
