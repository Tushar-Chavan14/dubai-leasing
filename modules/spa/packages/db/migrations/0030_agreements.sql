CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"template_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"doc_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"values_hash" text NOT NULL,
	"field_sources" jsonb NOT NULL,
	"rules_version" text NOT NULL,
	"policy_version" integer NOT NULL,
	"approval_id" uuid,
	"prepared_by" text NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreements_kind" CHECK ("kind" in ('spa', 'mou', 'assignment', 'listing_agreement')),
	CONSTRAINT "agreements_status" CHECK ("status" in ('prepared', 'in_review', 'approved', 'superseded')),
	CONSTRAINT "agreements_version_positive" CHECK ("agreements"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_plan_rows" (
	"deal_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"label" text NOT NULL,
	"due_on" date,
	"milestone" text,
	"amount_fils" bigint NOT NULL,
	"entered_by" text NOT NULL,
	CONSTRAINT "payment_plan_rows_deal_id_seq_pk" PRIMARY KEY("deal_id","seq"),
	CONSTRAINT "payment_plan_rows_amount_positive" CHECK ("payment_plan_rows"."amount_fils" > 0),
	CONSTRAINT "payment_plan_rows_when" CHECK ("payment_plan_rows"."due_on" is not null or "payment_plan_rows"."milestone" is not null)
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_template_version_id_spa_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."spa_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_rows" ADD CONSTRAINT "payment_plan_rows_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreements_version_uq" ON "agreements" USING btree ("deal_id","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agreements_one_live_uq" ON "agreements" USING btree ("deal_id","kind") WHERE "agreements"."status" <> 'superseded';