import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  billingOrderStatusValues,
  sessionAccessKindValues,
} from "@/lib/contracts/billing";
import { sessionEventTypeValues } from "@/lib/contracts/event";
import {
  sessionSolutionFormatValues,
  sessionSolutionStatusValues,
} from "@/lib/contracts/solution";
import {
  sessionLanguageValues,
  sessionStatusValues,
  sessionSolutionGenerationStatusValues,
  sessionTypeValues,
} from "@/lib/contracts/session";
import { account, session, user, verification } from "@/server/db/auth-schema";

export { account, session, user, verification };

export const sessionStatuses = sessionStatusValues;

export const sessionLanguages = sessionLanguageValues;

export const sessionTypes = sessionTypeValues;

export const sessionSolutionGenerationStatuses =
  sessionSolutionGenerationStatusValues;

export const sessionEventTypes = sessionEventTypeValues;

export const sessionSolutionStatuses = sessionSolutionStatusValues;

export const sessionSolutionFormats = sessionSolutionFormatValues;

export const billingOrderStatuses = billingOrderStatusValues;
export const sessionAccessKinds = sessionAccessKindValues;

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type", { enum: sessionTypes }).notNull().default("coding"),
    language: text("language", { enum: sessionLanguages }),
    status: text("status", { enum: sessionStatuses }).notNull().default("draft"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    endedAt: timestamp("ended_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    solutionEnabled: boolean("solution_enabled").notNull().default(false),
    solutionGenerationStatus: text("solution_generation_status", {
      enum: sessionSolutionGenerationStatuses,
    })
      .notNull()
      .default("idle"),
    solutionGenerationStartedAt: timestamp("solution_generation_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    solutionGenerationDebounceUntil: timestamp("solution_generation_debounce_until", {
      withTimezone: true,
      mode: "date",
    }),
    solutionGenerationMaxWaitUntil: timestamp("solution_generation_max_wait_until", {
      withTimezone: true,
      mode: "date",
    }),
    solutionGenerationSourceEventSequence: integer(
      "solution_generation_source_event_sequence",
    ),
    accessKind: text("access_kind", { enum: sessionAccessKinds }),
    trialEndsAt: timestamp("trial_ends_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => ({
    userCreatedAtIdx: index("sessions_user_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    statusCreatedAtIdx: index("sessions_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type", { enum: sessionEventTypes }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    sessionCreatedAtIdx: index("session_events_session_created_at_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    sessionSequenceIdx: index("session_events_session_sequence_idx").on(
      table.sessionId,
      table.sequence,
    ),
    sessionSequenceUniqueIdx: uniqueIndex(
      "session_events_session_sequence_unique_idx",
    ).on(table.sessionId, table.sequence),
  }),
);

export const sessionSolutions = pgTable(
  "session_solutions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    status: text("status", { enum: sessionSolutionStatuses }).notNull(),
    format: text("format", { enum: sessionSolutionFormats })
      .notNull()
      .default("markdown"),
    content: text("content").notNull(),
    version: integer("version").notNull(),
    sourceEventSequence: integer("source_event_sequence").notNull(),
    errorMessage: text("error_message"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionCreatedAtIdx: index("session_solutions_session_created_at_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    sessionSourceEventSequenceIdx: index(
      "session_solutions_session_source_event_sequence_idx",
    ).on(table.sessionId, table.sourceEventSequence),
    sessionVersionUniqueIdx: uniqueIndex(
      "session_solutions_session_version_unique_idx",
    ).on(table.sessionId, table.version),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type SessionEvent = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;

export type SessionSolution = typeof sessionSolutions.$inferSelect;
export type NewSessionSolution = typeof sessionSolutions.$inferInsert;

// ---------------------------------------------------------------------------
// Billing tables
// ---------------------------------------------------------------------------

export const billingOrders = pgTable(
  "billing_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    polarCheckoutId: text("polar_checkout_id").notNull().unique(),
    polarOrderId: text("polar_order_id").unique(),
    polarProductId: text("polar_product_id").notNull(),
    status: text("status", { enum: billingOrderStatuses }).notNull().default("created"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("usd"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("billing_orders_user_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    statusIdx: index("billing_orders_status_idx").on(table.status),
  }),
);

export const userBillingProfiles = pgTable(
  "user_billing_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    polarCustomerId: text("polar_customer_id").unique(),
    purchasedSessionCredits: integer("purchased_session_credits")
      .notNull()
      .default(0),
    trialUsedAt: timestamp("trial_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
);

export type BillingOrder = typeof billingOrders.$inferSelect;
export type NewBillingOrder = typeof billingOrders.$inferInsert;

export type UserBillingProfile = typeof userBillingProfiles.$inferSelect;
export type NewUserBillingProfile = typeof userBillingProfiles.$inferInsert;
