CREATE TYPE "public"."kit_subscriber_state" AS ENUM('unknown', 'active', 'inactive', 'bounced', 'complained', 'cancelled', 'deleted');--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kit_subscriber_id" bigint,
	"kit_state" "kit_subscriber_state" DEFAULT 'unknown' NOT NULL,
	"kit_form_id" text,
	"consent_at" timestamp with time zone NOT NULL,
	"first_synced_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscribers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ENABLE ROW LEVEL SECURITY;
