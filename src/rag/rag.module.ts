import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { RagService } from './rag.service';
import { VoyageModule } from './voyage.module';

@Module({
  imports: [VoyageModule],
  providers: [EmbeddingService, RagService],
  exports: [EmbeddingService, RagService],
})
export class RagModule {}
