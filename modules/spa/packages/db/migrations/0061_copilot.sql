CREATE TABLE "copilot_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"deal_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "copilot_drafts_kind" CHECK ("kind" in ('email', 'summary', 'approval_note'))
);
--> statement-breakpoint
CREATE TABLE "copilot_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"deal_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "copilot_proposals_kind" CHECK ("kind" in ('request_documents', 'create_task', 'resend_signing_link', 'prepare_agreement')),
	CONSTRAINT "copilot_proposals_status" CHECK ("status" in ('proposed', 'confirmed', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "assistant_threads" DROP CONSTRAINT "assistant_threads_kind";--> statement-breakpoint
ALTER TABLE "spa_tasks" DROP CONSTRAINT "spa_tasks_kind";--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_user_id_spa_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_proposals" ADD CONSTRAINT "copilot_proposals_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_proposals" ADD CONSTRAINT "copilot_proposals_user_id_spa_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_proposals" ADD CONSTRAINT "copilot_proposals_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_drafts_user_idx" ON "copilot_drafts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_proposals_user_idx" ON "copilot_proposals" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_kind" CHECK ("kind" in ('party', 'listing', 'template', 'staff'));--> statement-breakpoint
ALTER TABLE "spa_tasks" ADD CONSTRAINT "spa_tasks_kind" CHECK ("kind" in ('payment_not_escrow', 'payment_review', 'confirm_amount', 'default_flagged', 'milestone_reached', 'registry_rejected', 'registry_unavailable', 'instalment_overdue', 'helper_off', 'helper_rejected', 'chase_overdue', 'copilot_task'));