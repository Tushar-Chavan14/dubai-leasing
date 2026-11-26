CREATE TABLE "agreement_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"flags" jsonb NOT NULL,
	"dropped" integer NOT NULL,
	"model_tag" text,
	"prompt_version" text NOT NULL,
	"instruction_found" boolean NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_reviews_dropped" CHECK ("agreement_reviews"."dropped" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chase_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"paused_by" text NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	"resumed_at" timestamp with time zone,
	"resumed_by" text
);
--> statement-breakpoint
CREATE TABLE "chase_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chase_templates_kind" CHECK ("kind" in ('chase')),
	CONSTRAINT "chase_templates_status" CHECK ("status" in ('draft', 'approved', 'retired')),
	CONSTRAINT "chase_templates_version" CHECK ("chase_templates"."version" >= 1),
	CONSTRAINT "chase_templates_approved_who" CHECK ("chase_templates"."status" = 'draft' or ("chase_templates"."approved_by" is not null and "chase_templates"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "chases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"reason_code" text NOT NULL,
	"step" integer NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"subject" text NOT NULL,
	"body_sha256" text NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chases_reason" CHECK ("reason_code" in ('document_missing', 'passport_expired', 'document_expired', 'photo_unreadable', 'name_differs_title_deed', 'name_differs_deal', 'wrong_document', 'additional_documents')),
	CONSTRAINT "chases_step" CHECK ("chases"."step" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spa_helper_settings" DROP CONSTRAINT "spa_helper_settings_helper";--> statement-breakpoint
ALTER TABLE "spa_tasks" DROP CONSTRAINT "spa_tasks_kind";--> statement-breakpoint
ALTER TABLE "agreement_reviews" ADD CONSTRAINT "agreement_reviews_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_reviews" ADD CONSTRAINT "agreement_reviews_run_id_helper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."helper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chase_pauses" ADD CONSTRAINT "chase_pauses_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_template_id_chase_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."chase_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chases" ADD CONSTRAINT "chases_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_reviews_once_uq" ON "agreement_reviews" USING btree ("agreement_id","prompt_version");--> statement-breakpoint
CREATE UNIQUE INDEX "chase_pauses_one_open_uq" ON "chase_pauses" USING btree ("deal_id") WHERE "chase_pauses"."resumed_at" is null;--> statement-breakpoint
CREATE INDEX "chase_pauses_deal_idx" ON "chase_pauses" USING btree ("deal_id","paused_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chase_templates_kind_version_uq" ON "chase_templates" USING btree ("kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "chases_once_uq" ON "chases" USING btree ("party_id","item_key","step");--> statement-breakpoint
CREATE INDEX "chases_deal_idx" ON "chases" USING btree ("deal_id","created_at");--> statement-breakpoint
ALTER TABLE "spa_helper_settings" ADD CONSTRAINT "spa_helper_settings_helper" CHECK ("helper" in ('spa_ownership_check', 'spa_kyc', 'spa_company_check', 'spa_document_reader', 'spa_prepare', 'registry', 'spa_agreement_review'));--> statement-breakpoint
ALTER TABLE "spa_tasks" ADD CONSTRAINT "spa_tasks_kind" CHECK ("kind" in ('payment_not_escrow', 'payment_review', 'confirm_amount', 'default_flagged', 'milestone_reached', 'registry_rejected', 'registry_unavailable', 'instalment_overdue', 'helper_off', 'helper_rejected', 'chase_overdue'));