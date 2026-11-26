-- IF NOT EXISTS (hand-added), as in 0000: safe to run on a registry that already has these.
CREATE SEQUENCE IF NOT EXISTS "ejari_mock"."tawtheeq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "ejari_mock"."registrations" ADD COLUMN IF NOT EXISTS "system" text DEFAULT 'ejari' NOT NULL;--> statement-breakpoint
ALTER TABLE "ejari_mock"."submissions" ADD COLUMN IF NOT EXISTS "system" text DEFAULT 'ejari' NOT NULL;
