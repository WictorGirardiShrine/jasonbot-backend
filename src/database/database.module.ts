import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DB = Symbol('DB');

export type Database = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = postgres(config.getOrThrow<string>('DATABASE_URL'), {
          prepare: false,
          max: 10,
        });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
