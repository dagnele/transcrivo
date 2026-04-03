ALTER TABLE "sessions" ADD COLUMN "solution_generation_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "solution_generation_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "solution_generation_debounce_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "solution_generation_max_wait_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "solution_generation_source_event_sequence" integer;