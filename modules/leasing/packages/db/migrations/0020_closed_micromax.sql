CREATE TABLE "visitor_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visitor_verifications" ADD CONSTRAINT "visitor_verifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitor_verifications_conversation_idx" ON "visitor_verifications" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "visitor_verifications_email_idx" ON "visitor_verifications" USING btree ("email","created_at");