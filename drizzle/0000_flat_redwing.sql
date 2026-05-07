CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"disclaimer_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles"
	ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "profiles_self_select" ON "profiles" FOR SELECT USING (auth.uid() = id);
--> statement-breakpoint
CREATE POLICY "profiles_self_update" ON "profiles" FOR UPDATE USING (auth.uid() = id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
	LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	INSERT INTO public.profiles (id, name, disclaimer_accepted_at)
	VALUES (
		NEW.id,
		COALESCE(
			NEW.raw_user_meta_data->>'name',
			NEW.raw_user_meta_data->>'full_name',
			split_part(NEW.email, '@', 1)
		),
		(NEW.raw_user_meta_data->>'disclaimer_accepted_at')::timestamptz
	);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
	FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
