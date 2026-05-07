import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export const ANTHROPIC = Symbol('ANTHROPIC');

@Global()
@Module({
  providers: [
    {
      provide: ANTHROPIC,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Anthropic({ apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY') }),
    },
  ],
  exports: [ANTHROPIC],
})
export class AnthropicModule {}
