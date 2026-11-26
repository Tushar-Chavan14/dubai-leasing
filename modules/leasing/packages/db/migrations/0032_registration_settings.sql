CREATE TABLE "registration_settings" (
	"emirate" text PRIMARY KEY NOT NULL,
	"values" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ejari_submissions" ADD COLUMN "mode" text DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "ejari_submissions" ADD COLUMN "fee_paid_fils" bigint;--> statement-breakpoint
ALTER TABLE "ejari_submissions" ADD COLUMN "recorded_by" text;