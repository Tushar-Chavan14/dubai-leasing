CREATE TABLE "spa_template_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"doc_id" text NOT NULL,
	"doc_hash" text NOT NULL,
	"sections" jsonb NOT NULL,
	"blanks" jsonb NOT NULL,
	"look" jsonb NOT NULL,
	"party_blocks" jsonb NOT NULL,
	"signature_roles" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"rules_version" text NOT NULL,
	"status" text DEFAULT 'in_review' NOT NULL,
	"approval_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "spa_template_versions_status" CHECK ("status" in ('in_review', 'approved', 'rejected', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "spa_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"document_kind" text NOT NULL,
	"project_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spa_templates_kind" CHECK ("document_kind" in ('spa', 'mou', 'assignment', 'listing_agreement'))
);
--> statement-breakpoint
ALTER TABLE "spa_template_versions" ADD CONSTRAINT "spa_template_versions_template_id_spa_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."spa_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spa_template_versions" ADD CONSTRAINT "spa_template_versions_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spa_template_versions_version_uq" ON "spa_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "spa_template_versions_one_approved_uq" ON "spa_template_versions" USING btree ("template_id") WHERE "spa_template_versions"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "spa_templates_name_kind_uq" ON "spa_templates" USING btree ("name","document_kind");