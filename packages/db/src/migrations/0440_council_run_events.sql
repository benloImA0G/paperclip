CREATE TABLE IF NOT EXISTS "council_run_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "room_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "council_run_events_run_sequence_idx" ON "council_run_events" ("run_id", "sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "council_run_events_room_created_idx" ON "council_run_events" ("room_id", "created_at");
