import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, Observable } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { UsersService } from './users.service';

/**
 * Fires after JwtAuthGuard. Calls UsersService.getOrCreateProfile() so that
 * the very first authenticated request (to ANY endpoint) bootstraps the
 * profile + subscription rows and triggers the Kit subscribe — instead of
 * relying on the frontend hitting GET /me first.
 *
 * For existing profiles this costs one race-safe INSERT ... ON CONFLICT DO
 * NOTHING which is effectively free.
 */
@Injectable()
export class ProfileBootstrapInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ProfileBootstrapInterceptor.name);

  constructor(private readonly users: UsersService) {
    this.logger.log('ProfileBootstrapInterceptor registered');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user?.id || !user.email) {
      return next.handle();
    }

    return from(this.users.getOrCreateProfile(user.id, user.email)).pipe(
      switchMap(() => next.handle()),
      catchError((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { userId: user.id, err: message },
          'Profile bootstrap failed — letting request proceed',
        );
        return next.handle();
      }),
    );
  }
}
