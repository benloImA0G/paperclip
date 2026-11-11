CREATE TABLE IF NOT EXISTS "memory_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "source_url" text,
  "source_label" text,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "origin_kind" text DEFAULT 'manual' NOT NULL,
  "origin_ref" text,
  "created_by_label" text NOT NULL,
  "withdrawn_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_entries_company_status_idx" ON "memory_entries" ("company_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_entries_active_unique" ON "memory_entries" ("company_id", "kind", "title") WHERE "status" = 'active';
