import { z } from "zod";

import { sessionIdSchema } from "@/lib/contracts/session";

const nullishOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const sessionSolutionStatusValues = ["draft", "ready", "error"] as const;

export const sessionSolutionFormatValues = ["markdown"] as const;

export const sessionSolutionEventTypeValues = [
  "solution.generating",
  "solution.updated",
  "solution.ready",
  "solution.failed",
] as const;

export const sessionSolutionIdSchema = z.string().trim().min(1).max(128);

export const sessionSolutionStatusSchema = z.enum(sessionSolutionStatusValues);

export const sessionSolutionFormatSchema = z.enum(sessionSolutionFormatValues);

export const sessionSolutionEventTypeSchema = z.enum(sessionSolutionEventTypeValues);

export const sessionSolutionMetadataSchema = nullishOptional(
  z.record(z.string(), z.unknown())
);

export const sessionSolutionSchema = z.object({
  id: sessionSolutionIdSchema,
  sessionId: sessionIdSchema,
  status: sessionSolutionStatusSchema,
  format: sessionSolutionFormatSchema,
  content: z.string(),
  version: z.number().int().positive(),
  sourceEventSequence: z.number().int().nonnegative(),
  errorMessage: nullishOptional(z.string().min(1)),
  provider: nullishOptional(z.string().trim().min(1).max(128)),
  model: nullishOptional(z.string().trim().min(1).max(256)),
  promptVersion: nullishOptional(z.string().trim().min(1).max(128)),
  meta: sessionSolutionMetadataSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

const solutionPayloadBaseSchema = z.object({
  solutionId: sessionSolutionIdSchema,
  sessionId: sessionIdSchema,
  version: z.number().int().positive(),
  format: sessionSolutionFormatSchema,
  sourceEventSequence: z.number().int().nonnegative(),
  createdAt: z.date(),
  provider: nullishOptional(z.string().trim().min(1).max(128)),
  model: nullishOptional(z.string().trim().min(1).max(256)),
  promptVersion: nullishOptional(z.string().trim().min(1).max(128)),
  meta: sessionSolutionMetadataSchema,
});

export const solutionGeneratingPayloadSchema = solutionPayloadBaseSchema.extend({
  status: z.literal("draft"),
  content: z.string().optional(),
});

export const solutionUpdatedPayloadSchema = solutionPayloadBaseSchema.extend({
  status: z.literal("draft"),
  content: z.string().min(1),
});

export const solutionReadyPayloadSchema = solutionPayloadBaseSchema.extend({
  status: z.literal("ready"),
  content: z.string().min(1),
});

export const solutionFailedPayloadSchema = solutionPayloadBaseSchema.extend({
  status: z.literal("error"),
  content: z.string().optional(),
  errorMessage: z.string().min(1),
});

export const sessionSolutionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("solution.generating"),
    payload: solutionGeneratingPayloadSchema,
  }),
  z.object({
    type: z.literal("solution.updated"),
    payload: solutionUpdatedPayloadSchema,
  }),
  z.object({
    type: z.literal("solution.ready"),
    payload: solutionReadyPayloadSchema,
  }),
  z.object({
    type: z.literal("solution.failed"),
    payload: solutionFailedPayloadSchema,
  }),
]);

export const sessionSolutionInputSchema = z.object({
  sessionId: sessionIdSchema,
});

export const sessionSolutionHistoryInputSchema = z.object({
  sessionId: sessionIdSchema,
  afterVersion: z.number().int().positive().optional(),
});

export type SessionSolutionStatus = z.infer<typeof sessionSolutionStatusSchema>;
export type SessionSolutionFormat = z.infer<typeof sessionSolutionFormatSchema>;
export type SessionSolution = z.infer<typeof sessionSolutionSchema>;
export type SessionSolutionEvent = z.infer<typeof sessionSolutionEventSchema>;
