CREATE TABLE "spa_kyc_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"version" integer,
	"values" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "spa_kyc_configs_role" CHECK ("role" in ('buyer_person', 'seller_person', 'company_party', 'beneficial_owner')),
	CONSTRAINT "spa_kyc_configs_scope" CHECK ("scope" in ('any', 'primary_offplan', 'resale_ready', 'resale_offplan')),
	CONSTRAINT "spa_kyc_configs_status" CHECK ("status" in ('draft', 'published')),
	CONSTRAINT "spa_kyc_configs_version" CHECK (("spa_kyc_configs"."status" = 'draft') = ("spa_kyc_configs"."version" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spa_kyc_configs_one_draft_uq" ON "spa_kyc_configs" USING btree ("role","scope") WHERE "spa_kyc_configs"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "spa_kyc_configs_version_uq" ON "spa_kyc_configs" USING btree ("role","scope","version");