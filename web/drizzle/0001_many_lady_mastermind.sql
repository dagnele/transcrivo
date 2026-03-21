ALTER TABLE "session_events" DROP CONSTRAINT "session_events_session_id_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "session_events" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "session_events" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session_events" ALTER COLUMN "session_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
