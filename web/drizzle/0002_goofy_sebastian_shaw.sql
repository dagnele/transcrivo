CREATE TABLE "session_solutions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"status" text NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"source_event_sequence" integer NOT NULL,
	"error_message" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_solutions" ADD CONSTRAINT "session_solutions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_solutions_session_created_at_idx" ON "session_solutions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "session_solutions_session_source_event_sequence_idx" ON "session_solutions" USING btree ("session_id","source_event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "session_solutions_session_version_unique_idx" ON "session_solutions" USING btree ("session_id","version");