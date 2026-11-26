CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"trade_licence_no" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contract_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"category" text NOT NULL,
	"subtype" text,
	"tenures" text[] NOT NULL,
	"min_cheques" smallint NOT NULL,
	"max_cheques" smallint NOT NULL,
	"clause_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"sample_document_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_rules_cheques_ck" CHECK (1 <= "contract_rules"."min_cheques" AND "contract_rules"."min_cheques" <= "contract_rules"."max_cheques" AND "contract_rules"."max_cheques" <= 12)
);
--> statement-breakpoint
CREATE TABLE "rent_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"category" text NOT NULL,
	"subtype" text,
	"emirate" text NOT NULL,
	"community" text,
	"min_pct_bp" integer NOT NULL,
	"max_pct_bp" integer NOT NULL,
	"min_rent_fils" bigint,
	"max_rent_fils" bigint,
	"active" boolean DEFAULT true NOT NULL,
	"supersedes_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_rules_pct_ck" CHECK ("rent_rules"."min_pct_bp" <= "rent_rules"."max_pct_bp")
);
--> statement-breakpoint
ALTER TABLE "units" RENAME COLUMN "kind" TO "category";--> statement-breakpoint
DROP INDEX "sri_averages_uq";--> statement-breakpoint
ALTER TABLE "sri_averages" ALTER COLUMN "bedrooms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sri_averages" ALTER COLUMN "avg_annual_rent_fils" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sri_averages" ADD COLUMN "category" text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE "sri_averages" ADD COLUMN "avg_annual_rent_per_sqft_fils" bigint;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "company_id" uuid;--> statement-breakpoint
INSERT INTO "companies" ("id", "name", "slug", "kind", "created_by") SELECT '00000000-0000-7000-8000-00000000c001', 'Default company', 'default', 'owner', 'migration' WHERE EXISTS (SELECT 1 FROM "units");--> statement-breakpoint
UPDATE "units" SET "company_id" = '00000000-0000-7000-8000-00000000c001';--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "emirate" text DEFAULT 'dubai' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "country" text DEFAULT 'AE' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_rules" ADD CONSTRAINT "contract_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rules" ADD CONSTRAINT "rent_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_rules_company_idx" ON "contract_rules" USING btree ("company_id","category","active");--> statement-breakpoint
CREATE INDEX "rent_rules_company_idx" ON "rent_rules" USING btree ("company_id","category","active");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_company_idx" ON "units" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "sri_averages" ADD CONSTRAINT "sri_averages_uq" UNIQUE NULLS NOT DISTINCT("community","category","bedrooms","effective_from");--> statement-breakpoint
ALTER TABLE "sri_averages" ADD CONSTRAINT "sri_averages_one_rent_ck" CHECK (("sri_averages"."avg_annual_rent_per_sqft_fils" IS NULL) <> ("sri_averages"."avg_annual_rent_fils" IS NULL));