CREATE TABLE "alert_settings" (
	"gate" text NOT NULL,
	"version" integer NOT NULL,
	"threshold_hours" integer NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alert_settings_gate_version_pk" PRIMARY KEY("gate","version"),
	CONSTRAINT "alert_settings_gate" CHECK ("gate" in ('seller_verification', 'price_out_of_range', 'kyc_review', 'aml_flag', 'aml_report', 'template_approval', 'agreement_approval', 'noc_review', 'settlement_approval', 'oqood_submission', 'transfer_submission', 'cancellation', 'deposit_release', 'edd_signoff', 'helper_review', 'refund')),
	CONSTRAINT "alert_settings_hours" CHECK ("alert_settings"."threshold_hours" > 0)
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"approval_id" uuid NOT NULL,
	"level" text NOT NULL,
	"user_id" uuid NOT NULL,
	"waited_hours" integer NOT NULL,
	"outbound_message_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alerts_level" CHECK ("level" in ('approver', 'manager')),
	CONSTRAINT "alerts_hours" CHECK ("alerts"."waited_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"csv_sha256" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"csv_key" text NOT NULL,
	"pdf_key" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "compliance_reports_period_unique" UNIQUE("period"),
	CONSTRAINT "compliance_reports_period" CHECK ("compliance_reports"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "retention_review_items" (
	"review_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"ended_on" date NOT NULL,
	"status" text DEFAULT 'listed' NOT NULL,
	CONSTRAINT "retention_review_items_review_id_deal_id_pk" PRIMARY KEY("review_id","deal_id"),
	CONSTRAINT "retention_review_items_status" CHECK ("status" in ('listed', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "retention_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'listed' NOT NULL,
	"retention_years" integer NOT NULL,
	"cutoff_on" date NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "retention_reviews_period_unique" UNIQUE("period"),
	CONSTRAINT "retention_reviews_period" CHECK ("retention_reviews"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "retention_reviews_status" CHECK ("status" in ('listed', 'approved')),
	CONSTRAINT "retention_reviews_approved_needs_who" CHECK ("retention_reviews"."status" = 'listed' or ("retention_reviews"."approved_by" is not null and "retention_reviews"."approved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid,
	"kind" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_count" integer NOT NULL,
	CONSTRAINT "exports_kind" CHECK ("kind" in ('case_pack', 'monthly_report')),
	CONSTRAINT "exports_kind_deal" CHECK (("exports"."kind" = 'case_pack') = ("exports"."deal_id" is not null)),
	CONSTRAINT "exports_size" CHECK ("exports"."size_bytes" > 0),
	CONSTRAINT "exports_files" CHECK ("exports"."file_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "alert_settings" ADD CONSTRAINT "alert_settings_set_by_spa_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_spa_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_review_items" ADD CONSTRAINT "retention_review_items_review_id_retention_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."retention_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_review_items" ADD CONSTRAINT "retention_review_items_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_reviews" ADD CONSTRAINT "retention_reviews_approved_by_spa_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_spa_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."spa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_once_uq" ON "alerts" USING btree ("approval_id","level","user_id");--> statement-breakpoint
CREATE INDEX "alerts_user_idx" ON "alerts" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "retention_review_items_deal_idx" ON "retention_review_items" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "exports_deal_idx" ON "exports" USING btree ("deal_id","requested_at");