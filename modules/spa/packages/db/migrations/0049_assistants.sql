CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_name" text,
	"verified" boolean DEFAULT true NOT NULL,
	"unverified_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope_blocked" boolean DEFAULT false NOT NULL,
	"model_tag" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_messages_role" CHECK ("role" in ('user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "assistant_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"applied_by" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_proposals_kind" CHECK ("kind" in ('remap_blank', 'rename_placeholder')),
	CONSTRAINT "assistant_proposals_status" CHECK ("status" in ('proposed', 'applied', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "assistant_rate_limits" (
	"key_hash" text NOT NULL,
	"bucket" text NOT NULL,
	"n" integer NOT NULL,
	CONSTRAINT "assistant_rate_limits_key_hash_bucket_pk" PRIMARY KEY("key_hash","bucket"),
	CONSTRAINT "assistant_rate_limits_n" CHECK ("assistant_rate_limits"."n" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assistant_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"principal_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_threads_kind" CHECK ("kind" in ('party', 'listing', 'template'))
);
--> statement-breakpoint
CREATE TABLE "listing_enquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"outbound_message_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_template_version_id_spa_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."spa_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_enquiries" ADD CONSTRAINT "listing_enquiries_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_enquiries" ADD CONSTRAINT "listing_enquiries_outbound_message_id_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_messages_thread_idx" ON "assistant_messages" USING btree ("thread_id","at");--> statement-breakpoint
CREATE INDEX "assistant_proposals_version_idx" ON "assistant_proposals" USING btree ("template_version_id","status");--> statement-breakpoint
CREATE INDEX "assistant_threads_subject_idx" ON "assistant_threads" USING btree ("kind","subject_id","principal_hash");--> statement-breakpoint
CREATE INDEX "listing_enquiries_listing_idx" ON "listing_enquiries" USING btree ("listing_id","created_at");