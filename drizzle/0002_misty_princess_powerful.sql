CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"title" text,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kb_documents_source_hash_uniq" ON "kb_documents" USING btree ("source","content_hash");
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_fkey"
	FOREIGN KEY ("document_id") REFERENCES "kb_documents"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_ivfflat" ON "kb_chunks"
	USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
--> statement-breakpoint
ALTER TABLE "kb_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "kb_chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "kb_documents_read_authenticated" ON "kb_documents"
	FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "kb_chunks_read_authenticated" ON "kb_chunks"
	FOR SELECT TO authenticated USING (true);
