CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"policy_version" integer NOT NULL,
	"rules_version" text NOT NULL,
	"points" integer NOT NULL,
	"level" text NOT NULL,
	"flagged" boolean NOT NULL,
	"detail" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "risk_assessments_level" CHECK ("level" in ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "spa_aml_policy" (
	"version" integer PRIMARY KEY NOT NULL,
	"values" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;