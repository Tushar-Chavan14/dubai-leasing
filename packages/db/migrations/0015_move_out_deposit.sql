CREATE TABLE "deposit_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"revision" smallint NOT NULL,
	"inspection_id" uuid,
	"deposit_fils" bigint NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions_fils" bigint NOT NULL,
	"refund_fils" bigint NOT NULL,
	"owed_fils" bigint DEFAULT 0 NOT NULL,
	"policy_version" integer,
	"status" text DEFAULT 'sent' NOT NULL,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"approval_id" uuid,
	"document_id" uuid,
	"response_inbound_id" uuid,
	"paid_on" date,
	"payment_ref" text,
	"paid_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "booked_by" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "move_out_on" date;--> statement-breakpoint
ALTER TABLE "deposit_statements" ADD CONSTRAINT "deposit_statements_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_statements" ADD CONSTRAINT "deposit_statements_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_statements_lease_rev_uq" ON "deposit_statements" USING btree ("lease_id","revision");