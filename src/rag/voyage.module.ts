import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VoyageAIClient } from 'voyageai';

export const VOYAGE = Symbol('VOYAGE');

@Global()
@Module({
  providers: [
    {
      provide: VOYAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new VoyageAIClient({ apiKey: config.getOrThrow<string>('VOYAGE_API_KEY') }),
    },
  ],
  exports: [VOYAGE],
})
export class VoyageModule {}
