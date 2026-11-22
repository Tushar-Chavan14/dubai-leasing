-- IF NOT EXISTS (hand-added): the migration tracker creates this schema before the first migration runs.
CREATE SCHEMA IF NOT EXISTS "oqood_mock";
--> statement-breakpoint
CREATE SEQUENCE "oqood_mock"."oqd_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "oqood_mock"."td_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "oqood_mock"."trf_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "oqood_mock"."person_records" (
	"id_no" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"expires_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oqood_mock"."registrations" (
	"registry_no" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'registered' NOT NULL,
	"unit_no" text NOT NULL,
	"buyers" jsonb NOT NULL,
	"sellers" jsonb NOT NULL,
	"price_fils" bigint NOT NULL,
	"issued_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oqood_mock"."submissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"registry_no" text,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_no" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_kind_request_id_unique" UNIQUE("kind","request_id")
);
--> statement-breakpoint
CREATE TABLE "oqood_mock"."title_deeds" (
	"title_deed_no" text PRIMARY KEY NOT NULL,
	"unit_no" text NOT NULL,
	"owners" jsonb NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oqood_mock"."trustee_bookings" (
	"booking_no" text PRIMARY KEY NOT NULL,
	"new_title_deed_no" text NOT NULL,
	"appointment_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oqood_mock"."unit_records" (
	"unit_no" text PRIMARY KEY NOT NULL,
	"project_code" text NOT NULL,
	"developer_name" text NOT NULL,
	"state" text DEFAULT 'available' NOT NULL
);
