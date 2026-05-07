CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_message_user_uniq" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
	FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey"
	FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_role_check"
	CHECK ("role" IN ('user','assistant'));
--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_fkey"
	FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_fkey"
	FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "sessions_user_updated_idx" ON "sessions"("user_id","updated_at" DESC);
--> statement-breakpoint
CREATE INDEX "messages_session_created_idx" ON "messages"("session_id","created_at");
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_feedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sessions_self_all" ON "sessions"
	FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--> statement-breakpoint
CREATE POLICY "messages_via_session_select" ON "messages" FOR SELECT
	USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = messages.session_id AND s.user_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY "messages_via_session_insert" ON "messages" FOR INSERT
	WITH CHECK (EXISTS (SELECT 1 FROM sessions s WHERE s.id = messages.session_id AND s.user_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY "messages_via_session_delete" ON "messages" FOR DELETE
	USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = messages.session_id AND s.user_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY "feedback_self_all" ON "message_feedback"
	FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
