CREATE TABLE "aml_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"status" text NOT NULL,
	"approval_id" uuid,
	"summary" text NOT NULL,
	"summary_model" text,
	"instruction_like" boolean NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "aml_cases_status" CHECK ("status" in ('open', 'info_requested', 'cleared', 'stopped', 'reported'))
);
--> statement-breakpoint
CREATE TABLE "aml_hits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"party_id" uuid,
	"subject_key" text NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"detail" text NOT NULL,
	"list_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "aml_hits_rule" CHECK ("rule" in ('sanctions', 'pep', 'third_party_payer', 'cash', 'high_risk_country', 'missing_source_of_funds', 'complex_ownership', 'not_screened', 'unconfirmed')),
	CONSTRAINT "aml_hits_severity" CHECK ("severity" in ('flag', 'warning'))
);
--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid,
	"subject_key" text NOT NULL,
	"trigger" text NOT NULL,
	"list_version" text NOT NULL,
	"sanctions_score" double precision,
	"pep_score" double precision,
	"exact" boolean NOT NULL,
	"matches" jsonb NOT NULL,
	"screened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "screenings_trigger" CHECK ("trigger" in ('offer', 'before_agreement', 'before_transfer', 'party_change', 'periodic', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "aml_cases" ADD CONSTRAINT "aml_cases_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_cases" ADD CONSTRAINT "aml_cases_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_hits" ADD CONSTRAINT "aml_hits_case_id_aml_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."aml_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_hits" ADD CONSTRAINT "aml_hits_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aml_cases_deal_idx" ON "aml_cases" USING btree ("deal_id","status");--> statement-breakpoint
CREATE INDEX "aml_hits_case_idx" ON "aml_hits" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "screenings_deal_idx" ON "screenings" USING btree ("deal_id","subject_key","screened_at");