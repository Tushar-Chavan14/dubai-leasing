CREATE TABLE "company_clauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_rule_id" uuid,
	"title" text NOT NULL,
	"text_en" text NOT NULL,
	"quote" text,
	"category" text NOT NULL,
	"has_values" boolean NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source_document_id" uuid,
	"helper_run_id" uuid,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_clauses" ADD CONSTRAINT "company_clauses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_clauses" ADD CONSTRAINT "company_clauses_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_clauses_company_idx" ON "company_clauses" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "company_clauses_doc_idx" ON "company_clauses" USING btree ("source_document_id");