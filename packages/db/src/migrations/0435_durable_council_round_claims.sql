CREATE TABLE "council_round_claims" (
	"issue_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "council_round_claims" ADD CONSTRAINT "council_round_claims_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "council_round_claims" ADD CONSTRAINT "council_round_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "council_round_claims_company_idx" ON "council_round_claims" USING btree ("company_id");
