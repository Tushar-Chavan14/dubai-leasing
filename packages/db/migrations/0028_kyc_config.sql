CREATE TABLE "company_kyc_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"form" jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "form_answers" jsonb;--> statement-breakpoint
ALTER TABLE "company_kyc_configs" ADD CONSTRAINT "company_kyc_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_kyc_configs_version_uq" ON "company_kyc_configs" USING btree ("company_id","version");