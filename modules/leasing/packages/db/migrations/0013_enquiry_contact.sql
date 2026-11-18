ALTER TABLE "conversations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "conversations_contact_email_idx" ON "conversations" USING btree ("contact_email");