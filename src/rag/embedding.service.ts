import { Inject, Injectable, Logger } from '@nestjs/common';
import type { VoyageAIClient } from 'voyageai';
import { VOYAGE } from './voyage.module';

const VOYAGE_MODEL = 'voyage-3-large';
const VOYAGE_BATCH_LIMIT = 128;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(@Inject(VOYAGE) private readonly voyage: VoyageAIClient) {}

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text], 'query');
    return vec;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embedBatch(texts, 'document');
  }

  private async embedBatch(
    inputs: string[],
    inputType: 'document' | 'query',
  ): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < inputs.length; i += VOYAGE_BATCH_LIMIT) {
      const batch = inputs.slice(i, i + VOYAGE_BATCH_LIMIT);
      const res = await this.voyage.embed({
        input: batch,
        model: VOYAGE_MODEL,
        inputType,
        outputDimension: 1024,
      });
      const data = res.data ?? [];
      // Voyage may return items out of order — sort by index to be safe.
      data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const item of data) {
        if (!item.embedding) {
          throw new Error(`Voyage returned empty embedding at batch index ${item.index}`);
        }
        results.push(item.embedding);
      }
    }
    return results;
  }
}
