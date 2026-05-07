import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, basename, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { PDFParse } from 'pdf-parse';
import { AppModule } from '../app.module';
import { DB, type Database } from '../database/database.module';
import { kbDocuments } from '../database/schema/kbDocuments';
import { kbChunks } from '../database/schema/kbChunks';
import { EmbeddingService } from '../rag/embedding.service';

const TARGET_CHARS = 2000; // ~500 tokens
const OVERLAP_CHARS = 200; // ~50 tokens
const MAX_INSERT_BATCH = 64;

type ChunkInput = {
  content: string;
  metadata: Record<string, unknown>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(process.cwd(), args.dir ?? '../docs/ai-knoladge_base');
  const reset = args.reset === true;

  const logger = new Logger('IngestKB');
  logger.log(`Reading from: ${dir} (reset=${reset})`);

  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  const db = ctx.get<Database>(DB);
  const embedder = ctx.get(EmbeddingService);

  try {
    const files = await listFiles(dir);
    logger.log(`Found ${files.length} files`);

    let totalChunks = 0;
    let skipped = 0;
    let processed = 0;

    for (const filePath of files) {
      const source = basename(filePath);
      const ext = extname(filePath).toLowerCase();
      const buf = await readFile(filePath);
      const hash = createHash('sha256').update(buf).digest('hex');

      const [existing] = await db
        .select()
        .from(kbDocuments)
        .where(eq(kbDocuments.source, source))
        .limit(1);

      if (existing && existing.contentHash === hash && !reset) {
        skipped++;
        continue;
      }

      if (existing) {
        await db.delete(kbDocuments).where(eq(kbDocuments.id, existing.id));
      }

      let chunks: ChunkInput[];
      try {
        if (ext === '.pdf') {
          chunks = await chunkPdf(buf, source);
        } else if (ext === '.txt' || ext === '.md') {
          const text = buf.toString('utf8');
          chunks = chunkText(text, source);
        } else {
          logger.warn(`Skipping unsupported file: ${source}`);
          continue;
        }
      } catch (err) {
        logger.error(`Failed to parse ${source}: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      if (chunks.length === 0) {
        logger.warn(`No chunks extracted from ${source}`);
        continue;
      }

      const title = inferTitle(source, chunks[0].content);
      const [doc] = await db
        .insert(kbDocuments)
        .values({ source, title, contentHash: hash })
        .returning();

      const embeddings = await embedder.embedDocuments(chunks.map((c) => c.content));
      const rows = chunks.map((c, i) => ({
        documentId: doc.id,
        content: c.content,
        embedding: embeddings[i],
        metadata: c.metadata,
      }));

      for (let i = 0; i < rows.length; i += MAX_INSERT_BATCH) {
        await db.insert(kbChunks).values(rows.slice(i, i + MAX_INSERT_BATCH));
      }

      processed++;
      totalChunks += rows.length;
      logger.log(`✓ ${source} → ${rows.length} chunks`);
    }

    logger.log(
      `Done. Processed ${processed} new/changed files (${totalChunks} chunks), skipped ${skipped} unchanged.`,
    );
  } finally {
    await ctx.close();
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    const s = await stat(full);
    if (s.isFile()) files.push(full);
  }
  return files.sort();
}

async function chunkPdf(buf: Buffer, source: string): Promise<ChunkInput[]> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const chunks: ChunkInput[] = [];
    for (const page of result.pages) {
      const pieces = splitText(page.text);
      for (const piece of pieces) {
        chunks.push({
          content: piece,
          metadata: { source_file: source, kind: 'pdf', page: page.num },
        });
      }
    }
    return chunks;
  } finally {
    await parser.destroy();
  }
}

function chunkText(text: string, source: string): ChunkInput[] {
  const isTranscript = /and Jason Andrews|Jason Andrews and|Bartz|Rickert|Carrie|Greg.*Orr|Dustin/i.test(source);
  const clientName = inferClientName(source);

  const baseMeta: Record<string, unknown> = {
    source_file: source,
    kind: isTranscript ? 'transcript' : 'text',
  };
  if (isTranscript && clientName) baseMeta.client_name = clientName;

  return splitText(text).map((piece) => ({
    content: piece,
    metadata: { ...baseMeta },
  }));
}

function splitText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const out: string[] = [];
  let buf = '';

  for (const para of paragraphs) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length <= TARGET_CHARS) {
      buf = candidate;
      continue;
    }
    if (buf) {
      out.push(buf);
      const tail = buf.length > OVERLAP_CHARS ? buf.slice(-OVERLAP_CHARS) : '';
      buf = tail ? `${tail}\n\n${para}` : para;
    } else {
      // Single paragraph longer than TARGET_CHARS — slice with overlap
      let i = 0;
      while (i < para.length) {
        const piece = para.slice(i, i + TARGET_CHARS);
        out.push(piece);
        i += TARGET_CHARS - OVERLAP_CHARS;
      }
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

function inferTitle(source: string, firstChunk: string): string {
  const stem = source.replace(/\.[^.]+$/, '');
  const firstLine = firstChunk.split('\n').find((l) => l.trim().length > 0);
  if (firstLine && firstLine.length < 120 && firstLine !== stem) return firstLine.trim();
  return stem;
}

function inferClientName(source: string): string | null {
  const m = source.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  if (!m) return null;
  const name = m[1];
  if (name.toLowerCase().includes('jason')) return null;
  return name;
}

function parseArgs(argv: string[]): { dir?: string; reset?: boolean } {
  const out: { dir?: string; reset?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--reset') out.reset = true;
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
