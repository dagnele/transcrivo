CREATE TABLE "billing_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"polar_checkout_id" text NOT NULL,
	"polar_order_id" text,
	"polar_product_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_orders_polar_checkout_id_unique" UNIQUE("polar_checkout_id"),
	CONSTRAINT "billing_orders_polar_order_id_unique" UNIQUE("polar_order_id")
);
--> statement-breakpoint
CREATE TABLE "user_billing_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"polar_customer_id" text,
	"purchased_session_credits" integer DEFAULT 0 NOT NULL,
	"trial_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_billing_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_billing_profiles_polar_customer_id_unique" UNIQUE("polar_customer_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "access_kind" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_billing_profiles" ADD CONSTRAINT "user_billing_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_orders_user_created_at_idx" ON "billing_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_orders_status_idx" ON "billing_orders" USING btree ("status");