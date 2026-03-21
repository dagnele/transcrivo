CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_events_session_created_at_idx" ON "session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "session_events_session_sequence_idx" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_sequence_unique_idx" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "sessions_status_created_at_idx" ON "sessions" USING btree ("status","created_at");