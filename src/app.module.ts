import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AnthropicModule } from './anthropic/anthropic.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { FeedbackModule } from './feedback/feedback.module';
import { MessagesModule } from './messages/messages.module';
import { RagModule } from './rag/rag.module';
import { SessionsModule } from './sessions/sessions.module';
import { SupabaseModule } from './supabase/supabase.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    SupabaseModule,
    AnthropicModule,
    AuthModule,
    UsersModule,
    SessionsModule,
    MessagesModule,
    FeedbackModule,
    RagModule,
    ChatModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
