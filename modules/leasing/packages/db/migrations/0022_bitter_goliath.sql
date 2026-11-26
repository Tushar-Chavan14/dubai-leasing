CREATE TABLE "company_contract_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"sample_document_id" uuid NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"sections" jsonb NOT NULL,
	"blanks" jsonb NOT NULL,
	"style" jsonb NOT NULL,
	"logo_document_id" uuid,
	"version" integer NOT NULL,
	"helper_run_id" uuid,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD CONSTRAINT "company_contract_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD CONSTRAINT "company_contract_templates_sample_document_id_documents_id_fk" FOREIGN KEY ("sample_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contract_templates" ADD CONSTRAINT "company_contract_templates_logo_document_id_documents_id_fk" FOREIGN KEY ("logo_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_contract_templates_version_uq" ON "company_contract_templates" USING btree ("company_id","version");--> statement-breakpoint
CREATE INDEX "company_contract_templates_company_idx" ON "company_contract_templates" USING btree ("company_id","status");