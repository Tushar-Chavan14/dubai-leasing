CREATE TABLE "settlement_lines" (
	"settlement_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"payer" text NOT NULL,
	"payee" text NOT NULL,
	"label" text NOT NULL,
	"amount_fils" bigint NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	CONSTRAINT "settlement_lines_settlement_id_seq_pk" PRIMARY KEY("settlement_id","seq"),
	CONSTRAINT "settlement_lines_amount_positive" CHECK ("settlement_lines"."amount_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"rules_version" text NOT NULL,
	"policy_version" integer NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"price_fils" bigint NOT NULL,
	"buyer_pays_fils" bigint NOT NULL,
	"seller_receives_fils" bigint NOT NULL,
	"approval_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "settlements_status" CHECK ("status" in ('proposed', 'approved', 'stale', 'superseded')),
	CONSTRAINT "settlements_version_positive" CHECK ("settlements"."version" > 0),
	CONSTRAINT "settlements_price_positive" CHECK ("settlements"."price_fils" > 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approval_id_spa_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."spa_approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_deal_version_uq" ON "settlements" USING btree ("deal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_one_live_uq" ON "settlements" USING btree ("deal_id") WHERE "settlements"."status" in ('proposed', 'approved');