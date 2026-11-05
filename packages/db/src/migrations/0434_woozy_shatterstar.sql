ALTER TABLE "council_seats" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "council_seats" ALTER COLUMN "grant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "council_seats" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "council_seats" ADD COLUMN "seat_kind" text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE "council_seats" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "council_seats" ADD CONSTRAINT "council_seats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_seats" ADD CONSTRAINT "council_seats_kind_shape_check" CHECK ((seat_kind = 'model' AND connection_id IS NOT NULL AND grant_id IS NOT NULL AND model IS NOT NULL AND agent_id IS NULL) OR (seat_kind = 'agent' AND agent_id IS NOT NULL));