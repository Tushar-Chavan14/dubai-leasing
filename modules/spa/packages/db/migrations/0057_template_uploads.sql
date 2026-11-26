CREATE TABLE "template_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"doc_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"version_id" uuid,
	"declared_no_real_data" boolean NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "template_uploads_status" CHECK ("status" in ('queued', 'reading', 'done', 'failed', 'needs_human')),
	CONSTRAINT "template_uploads_doc_hash" CHECK ("template_uploads"."doc_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "template_uploads_declared" CHECK ("template_uploads"."declared_no_real_data" = true)
);
--> statement-breakpoint
ALTER TABLE "template_uploads" ADD CONSTRAINT "template_uploads_template_id_spa_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."spa_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_uploads" ADD CONSTRAINT "template_uploads_version_id_spa_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."spa_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_uploads_template_hash_uq" ON "template_uploads" USING btree ("template_id","doc_hash");