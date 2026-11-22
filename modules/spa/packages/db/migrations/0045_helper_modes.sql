CREATE TABLE "helper_review_holds" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "helper_review_holds_status" CHECK ("status" in ('pending', 'released', 'rejected')),
	CONSTRAINT "helper_review_holds_decided" CHECK (("helper_review_holds"."status" = 'pending') = ("helper_review_holds"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "spa_helper_settings" (
	"helper" text NOT NULL,
	"scope" text DEFAULT '*' NOT NULL,
	"version" integer NOT NULL,
	"mode" text NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spa_helper_settings_helper_scope_version_pk" PRIMARY KEY("helper","scope","version"),
	CONSTRAINT "spa_helper_settings_helper" CHECK ("helper" in ('spa_ownership_check', 'spa_kyc', 'spa_company_check', 'spa_document_reader', 'spa_prepare', 'registry')),
	CONSTRAINT "spa_helper_settings_mode" CHECK ("mode" in ('auto', 'review', 'off')),
	CONSTRAINT "spa_helper_settings_scope" CHECK (length("spa_helper_settings"."scope") > 0),
	CONSTRAINT "spa_helper_settings_version" CHECK ("spa_helper_settings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "spa_tasks" DROP CONSTRAINT "spa_tasks_kind";--> statement-breakpoint
ALTER TABLE "helper_review_holds" ADD CONSTRAINT "helper_review_holds_run_id_helper_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."helper_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_review_holds" ADD CONSTRAINT "helper_review_holds_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_review_holds" ADD CONSTRAINT "helper_review_holds_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helper_review_holds_deal_idx" ON "helper_review_holds" USING btree ("deal_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "helper_review_holds_approval_uq" ON "helper_review_holds" USING btree ("approval_id");--> statement-breakpoint
ALTER TABLE "spa_tasks" ADD CONSTRAINT "spa_tasks_kind" CHECK ("kind" in ('payment_not_escrow', 'payment_review', 'confirm_amount', 'default_flagged', 'milestone_reached', 'registry_rejected', 'registry_unavailable', 'instalment_overdue', 'helper_off', 'helper_rejected'));