CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"attempt" integer NOT NULL,
	"request_id" text NOT NULL,
	"status" text NOT NULL,
	"registry_no" text,
	"issued_on" date,
	"reasons" jsonb NOT NULL,
	"approval_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registrations_kind" CHECK ("kind" in ('oqood_register', 'oqood_transfer', 'trustee_transfer')),
	CONSTRAINT "registrations_status" CHECK ("status" in ('submitted', 'issued', 'rejected', 'unavailable')),
	CONSTRAINT "registrations_issued_needs_number" CHECK ("registrations"."status" <> 'issued' or ("registrations"."registry_no" is not null and "registrations"."issued_on" is not null)),
	CONSTRAINT "registrations_attempt_positive" CHECK ("registrations"."attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_deal_kind_attempt_uq" ON "registrations" USING btree ("deal_id","kind","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_request_id_uq" ON "registrations" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_one_issued_uq" ON "registrations" USING btree ("deal_id","kind") WHERE "registrations"."status" = 'issued';