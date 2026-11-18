CREATE TABLE "approval_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"approval_id" uuid NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lease_id" uuid,
	"approval_id" uuid,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"lease_id" uuid NOT NULL,
	"complaint_id" uuid NOT NULL,
	"category" text NOT NULL,
	"urgency" smallint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_by" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "maintenance_tickets_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "at_risk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "source" text DEFAULT 'portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "inbound_event_id" uuid;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "helper_run_id" uuid;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "category_confidence" real;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "injection" real;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "room" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "complaint_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paid_ref" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "bounced_on" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "friendly_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "eviction_eligible_on" date;--> statement-breakpoint
ALTER TABLE "approval_notes" ADD CONSTRAINT "approval_notes_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_thread_id_copilot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."copilot_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_user_id_staff_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_drafts" ADD CONSTRAINT "copilot_drafts_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_notes_approval_idx" ON "approval_notes" USING btree ("approval_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_drafts_thread_idx" ON "copilot_drafts" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_tickets_complaint_uq" ON "maintenance_tickets" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "maintenance_tickets_status_idx" ON "maintenance_tickets" USING btree ("status","due_by");--> statement-breakpoint
CREATE INDEX "complaints_lease_idx" ON "complaints" USING btree ("lease_id");--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_inbound_uq" ON "complaints" USING btree ("inbound_event_id");--> statement-breakpoint
CREATE INDEX "documents_inspection_idx" ON "documents" USING btree ("inspection_id");