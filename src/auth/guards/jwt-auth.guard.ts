import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { SUPABASE_ADMIN } from '../../supabase/supabase.module';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Empty bearer token');

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.user = { id: data.user.id, email: data.user.email.toLowerCase() };
    return true;
  }
}
