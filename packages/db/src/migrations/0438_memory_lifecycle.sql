ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "supersedes_id" uuid;
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "superseded_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memory_entries" ADD COLUMN IF NOT EXISTS "use_count" integer DEFAULT 0 NOT NULL;
