ALTER TABLE "sessions" ADD COLUMN "type" text DEFAULT 'coding' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "language" text;
--> statement-breakpoint
UPDATE "sessions" SET "language" = 'python' WHERE "type" = 'coding' AND "language" IS NULL;
