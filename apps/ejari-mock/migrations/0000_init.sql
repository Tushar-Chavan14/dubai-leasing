-- IF NOT EXISTS (hand-added): adopts registries created before migrations, from the old start-up SQL.
CREATE SCHEMA IF NOT EXISTS "ejari_mock";
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "ejari_mock"."ejari_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ejari_mock"."icp_people" (
	"id_no" text PRIMARY KEY NOT NULL,
	"id_type" text NOT NULL,
	"name_en" text NOT NULL,
	"nationality" text,
	"expires_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ejari_mock"."properties" (
	"dld_property_no" text PRIMARY KEY NOT NULL,
	"unit_no" text NOT NULL,
	"makani_no" text NOT NULL,
	"plot_no" text,
	"usage" text DEFAULT 'residential' NOT NULL,
	"owner_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ejari_mock"."registrations" (
	"ejari_no" text PRIMARY KEY NOT NULL,
	"dld_property_no" text NOT NULL,
	"tenant_id_no" text NOT NULL,
	"tenant_name" text NOT NULL,
	"landlord_name" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"annual_rent_fils" bigint NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"payload" jsonb NOT NULL,
	"issued_on" date NOT NULL,
	"cancelled_on" date,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ejari_mock"."submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"ejari_no" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_request_id_unique" UNIQUE("request_id")
);
