CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"state" text DEFAULT 'ENQUIRY' NOT NULL,
	"source" text NOT NULL,
	"reservation_paid_on" date,
	"offer" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gate" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules_version" text,
	"approver_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by" text NOT NULL,
	"on_approve_event" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"edited_proposal" jsonb,
	"consumed_by_event_id" uuid,
	"created_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"values" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_policy_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"text" text NOT NULL,
	"room" text,
	"category" text,
	"urgency" smallint,
	"safety" real,
	"legal_threat" real,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"party_id" uuid,
	"application_id" uuid,
	"assigned_to" uuid,
	"status" text DEFAULT 'bot' NOT NULL,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"milestone" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"rules_version" text,
	"note" text,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"clock_offset_ms" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"party_id" uuid,
	"lease_id" uuid,
	"application_id" uuid,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"path" text NOT NULL,
	"mime" text,
	"extracted" jsonb,
	"verified_at" timestamp with time zone,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helper_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"helper" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"model" text,
	"confidence" real,
	"latency_ms" integer,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"tokens" integer,
	"event_id" uuid,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_on" date,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"done_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lease_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"actor" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rules_version" text,
	"at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lease_parties" (
	"lease_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "lease_parties_lease_id_party_id_role_pk" PRIMARY KEY("lease_id","party_id","role")
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"application_id" uuid,
	"previous_lease_id" uuid,
	"state" text DEFAULT 'CONTRACT' NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"annual_rent_fils" bigint NOT NULL,
	"cheques" smallint NOT NULL,
	"deposit_fils" bigint NOT NULL,
	"rules_version" text NOT NULL,
	"ejari_no" text,
	"ejari_issued_on" date,
	"ejari_cancelled_on" date,
	"deposit_settled_on" date,
	"source" text DEFAULT 'engine' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leases_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"full_name_en" text NOT NULL,
	"full_name_ar" text,
	"email" text,
	"phone" text,
	"nationality" text,
	"emirates_id_no" text,
	"passport_no" text,
	"trade_licence_no" text,
	"birth_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"due_on" date NOT NULL,
	"amount_fils" bigint NOT NULL,
	"method" text DEFAULT 'cheque' NOT NULL,
	"cheque_no" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"paid_on" date,
	"formal_reminder_sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignee_role" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_on" date,
	"dedupe_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"building" text NOT NULL,
	"community" text NOT NULL,
	"kind" text DEFAULT 'residential' NOT NULL,
	"state" text DEFAULT 'PREP' NOT NULL,
	"dld_property_no" text,
	"unit_no" text,
	"makani_no" text,
	"plot_no" text,
	"area_sqft" integer,
	"bedrooms" smallint,
	"furnished" boolean,
	"dewa_premise_no" text,
	"asking_rent_fils" bigint,
	"price_approved_at" timestamp with time zone,
	"landlord_party_id" uuid,
	"own_use_lock_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_staff_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_staff_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_parties" ADD CONSTRAINT "lease_parties_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_parties" ADD CONSTRAINT "lease_parties_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_landlord_party_id_parties_id_fk" FOREIGN KEY ("landlord_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_unit_idx" ON "applications" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "applications_party_idx" ON "applications" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approvals_entity_idx" ON "approvals" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_dedupe_uq" ON "approvals" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_chat_uq" ON "conversations" USING btree ("channel","external_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deadlines_entity_milestone_uq" ON "deadlines" USING btree ("entity_id","milestone");--> statement-breakpoint
CREATE INDEX "deadlines_due_idx" ON "deadlines" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "documents_party_idx" ON "documents" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "documents_sha_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "helper_runs_entity_idx" ON "helper_runs" USING btree ("entity_kind","entity_id","at");--> statement-breakpoint
CREATE INDEX "lease_events_entity_idx" ON "lease_events" USING btree ("entity_kind","entity_id","at");--> statement-breakpoint
CREATE INDEX "leases_unit_idx" ON "leases" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "leases_state_idx" ON "leases" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_unit_start_uq" ON "leases" USING btree ("unit_id","start_on");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "parties_email_idx" ON "parties" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_emirates_id_uq" ON "parties" USING btree ("emirates_id_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_lease_seq_uq" ON "payments" USING btree ("lease_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_uq" ON "tasks" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");