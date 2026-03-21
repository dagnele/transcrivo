import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { sessionEventTypeValues } from "@/lib/contracts/event";
import {
  sessionSolutionFormatValues,
  sessionSolutionStatusValues,
} from "@/lib/contracts/solution";
import {
  sessionLanguageValues,
  sessionStatusValues,
  sessionTypeValues,
} from "@/lib/contracts/session";
import { account, session, user, verification } from "@/server/db/auth-schema";

export { account, session, user, verification };

export const sessionStatuses = sessionStatusValues;

export const sessionLanguages = sessionLanguageValues;

export const sessionTypes = sessionTypeValues;

export const sessionEventTypes = sessionEventTypeValues;

export const sessionSolutionStatuses = sessionSolutionStatusValues;

export const sessionSolutionFormats = sessionSolutionFormatValues;

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
