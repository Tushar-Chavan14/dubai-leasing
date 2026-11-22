CREATE TABLE "company_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"status" text NOT NULL,
	"licence_expires_on" date,
	"signer_ok" boolean NOT NULL,
	"owners" jsonb NOT NULL,
	"layers" integer NOT NULL,
	"findings" jsonb NOT NULL,
	"docs_hash" text NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "company_checks_status" CHECK ("status" in ('passed', 'review', 'needs_human')),
	CONSTRAINT "company_checks_layers" CHECK ("company_checks"."layers" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_reads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"fields" jsonb NOT NULL,
	"model_tag" text,
	"prompt_version" text NOT NULL,
	"instruction_found" boolean DEFAULT false NOT NULL,
	"run_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_reads_profile" CHECK ("profile" in ('noc', 'liability_letter', 'release_letter', 'pre_approval', 'final_offer', 'sof_evidence', 'edd', 'trade_licence', 'moa', 'poa', 'board_resolution', 'title_deed', 'oqood'))
);
--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "company_checks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "company_checks_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_checks" ADD CONSTRAINT "company_checks_run_id_helper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."helper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reads" ADD CONSTRAINT "document_reads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reads" ADD CONSTRAINT "document_reads_run_id_helper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."helper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_checks_party_idx" ON "company_checks" USING btree ("deal_id","party_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_reads_once_uq" ON "document_reads" USING btree ("document_id","prompt_version");