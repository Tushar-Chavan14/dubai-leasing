ALTER TABLE "applications" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "requested_move_in_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "kyc_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "reservation_fils" bigint;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "reservation_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "bytes" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_via_link_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "id_expires_on" date;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "passport_expires_on" date;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "visa_no" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "visa_expires_on" date;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "trade_licence_expires_on" date;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_ref_uq" ON "applications" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "documents_application_idx" ON "documents" USING btree ("application_id");