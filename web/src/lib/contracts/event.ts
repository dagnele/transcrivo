import { z } from "zod";

import { sessionIdSchema } from "@/lib/contracts/session";

export const sessionEventTypeValues = [
  "session.started",
  "transcript.partial",
  "transcript.final",
  "session.ended",
  "session.failed",
] as const;

export const sessionEventTypeSchema = z.enum(sessionEventTypeValues);

export const sessionLifecyclePayloadSchema = z
  .object({
    reason: z.string().min(1).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .default({});

export const transcriptEventPayloadSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  utteranceId: z.string().trim().min(1).max(256),
  interviewId: z.string().trim().min(1).max(128).optional(),
  source: z.enum(["mic", "system"]),
  speaker: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
  language: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  chunkId: z.string().min(1).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const sessionEventPayloadSchema = z.record(z.string(), z.unknown());

export const sessionEventSchema = z.object({
  id: z.string().trim().min(1).max(128),
  sessionId: sessionIdSchema,
  sequence: z.number().int().nonnegative(),
  type: sessionEventTypeSchema,
  createdAt: z.date(),
  payload: sessionEventPayloadSchema,
});

export const sessionHistoryInputSchema = z.object({
  sessionId: sessionIdSchema,
  afterSequence: z.number().int().nonnegative().optional(),
});

export const ingestSessionEventInputSchema = z.object({
  sessionId: sessionIdSchema,
  type: sessionEventTypeSchema,
  payload: z.union([transcriptEventPayloadSchema, sessionLifecyclePayloadSchema]),
});

export type SessionEvent = z.infer<typeof sessionEventSchema>;
