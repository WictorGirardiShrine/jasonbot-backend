ALTER TABLE "subscriptions" ADD COLUMN "beta_access_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "subscriptions" SET "beta_access_expires_at" = now() + interval '30 days' WHERE "beta_access_expires_at" IS NULL;
