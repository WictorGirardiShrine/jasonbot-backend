import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_ADMIN = Symbol('SUPABASE_ADMIN');

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        return createClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
          },
        );
      },
    },
  ],
  exports: [SUPABASE_ADMIN],
})
export class SupabaseModule {}
