ALTER TABLE "conversations" ADD COLUMN "external_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "flow" jsonb DEFAULT '{"step":"idle"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "flow_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author" text;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_telegram_viewing_uq" ON "applications" USING btree ("unit_id","viewing_at") WHERE "applications"."state" = 'VIEWING' and "applications"."source" = 'telegram';--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_uq" ON "messages" USING btree ("conversation_id","direction","external_id");