CREATE TABLE "collection_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"plan_seq" integer NOT NULL,
	"milestone" text NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collection_reminders_milestone" CHECK ("collection_reminders"."milestone" ~ '^T[+-][0-9]{1,3}$')
);
--> statement-breakpoint
CREATE TABLE "registry_rejections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"registration_id" uuid NOT NULL,
	"codes" text[] NOT NULL,
	"mapped_field" text,
	"mapped_confidence" numeric(3, 2),
	"source" text NOT NULL,
	"action" text NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registry_rejections_source" CHECK ("source" in ('code', 'model')),
	CONSTRAINT "registry_rejections_action" CHECK ("action" in ('fixed', 'retry', 'task')),
	CONSTRAINT "registry_rejections_confidence" CHECK ("registry_rejections"."mapped_confidence" is null or ("registry_rejections"."mapped_confidence" >= 0 and "registry_rejections"."mapped_confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "spa_tasks" DROP CONSTRAINT "spa_tasks_kind";--> statement-breakpoint
DROP INDEX "registrations_deal_kind_attempt_uq";--> statement-breakpoint
DROP INDEX "registrations_request_id_uq";--> statement-breakpoint
ALTER TABLE "collection_reminders" ADD CONSTRAINT "collection_reminders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reminders" ADD CONSTRAINT "collection_reminders_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reminders" ADD CONSTRAINT "collection_reminders_plan_row_fk" FOREIGN KEY ("deal_id","plan_seq") REFERENCES "public"."payment_plan_rows"("deal_id","seq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_rejections" ADD CONSTRAINT "registry_rejections_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_rejections" ADD CONSTRAINT "registry_rejections_task_id_spa_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."spa_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_reminders_once_uq" ON "collection_reminders" USING btree ("deal_id","plan_seq","milestone");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_rejections_registration_uq" ON "registry_rejections" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_deal_kind_attempt_uq" ON "registrations" USING btree ("deal_id","kind","attempt") WHERE "registrations"."status" <> 'unavailable';--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_request_id_uq" ON "registrations" USING btree ("request_id") WHERE "registrations"."status" <> 'unavailable';--> statement-breakpoint
ALTER TABLE "spa_tasks" ADD CONSTRAINT "spa_tasks_kind" CHECK ("kind" in ('payment_not_escrow', 'payment_review', 'confirm_amount', 'default_flagged', 'milestone_reached', 'registry_rejected', 'registry_unavailable', 'instalment_overdue'));