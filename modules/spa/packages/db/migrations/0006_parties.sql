CREATE TABLE "beneficial_owners" (
	"company_party_id" uuid NOT NULL,
	"person_party_id" uuid NOT NULL,
	"share_bps" integer NOT NULL,
	CONSTRAINT "beneficial_owners_company_party_id_person_party_id_pk" PRIMARY KEY("company_party_id","person_party_id"),
	CONSTRAINT "beneficial_owners_share" CHECK ("beneficial_owners"."share_bps" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "companies_kind" CHECK ("kind" in ('developer', 'brokerage', 'both'))
);
--> statement-breakpoint
CREATE TABLE "company_details" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"trade_name" text NOT NULL,
	"licence_no" text NOT NULL,
	"licence_expires_on" date NOT NULL,
	"issuing_authority" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_parties" (
	"deal_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"order" integer NOT NULL,
	"share_bps" integer,
	CONSTRAINT "deal_parties_deal_id_role_order_pk" PRIMARY KEY("deal_id","role","order"),
	CONSTRAINT "deal_parties_role" CHECK ("role" in ('buyer', 'seller', 'broker'))
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"full_name_en" text NOT NULL,
	"nationality" text,
	"birth_on" date,
	"passport_no" text,
	"emirates_id_no" text,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "parties_kind" CHECK ("kind" in ('person', 'company'))
);
--> statement-breakpoint
CREATE TABLE "signatories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_party_id" uuid NOT NULL,
	"person_party_id" uuid NOT NULL,
	"title" text NOT NULL,
	"authority" text NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "signatories_authority" CHECK ("authority" in ('poa', 'board_resolution'))
);
--> statement-breakpoint
ALTER TABLE "beneficial_owners" ADD CONSTRAINT "beneficial_owners_company_party_id_parties_id_fk" FOREIGN KEY ("company_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficial_owners" ADD CONSTRAINT "beneficial_owners_person_party_id_parties_id_fk" FOREIGN KEY ("person_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_details" ADD CONSTRAINT "company_details_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatories" ADD CONSTRAINT "signatories_company_party_id_parties_id_fk" FOREIGN KEY ("company_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatories" ADD CONSTRAINT "signatories_person_party_id_parties_id_fk" FOREIGN KEY ("person_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;