import { z } from "zod";

import { sessionIdSchema } from "@/lib/contracts/session";

export const sessionSolutionStatusValues = ["draft", "ready", "error"] as const;

export const sessionSolutionFormatValues = ["markdown"] as const;

export const sessionSolutionEventTypeValues = [
  "solution.generating",
  "solution.updated",
  "solution.ready",
  "solution.failed",
] as const;

export const sessionSolutionIdSchema = z.string().trim().min(1).max(128);

const requiredMarkdownFieldSchema = z.string().trim().min(1).max(8_000);
const optionalMarkdownFieldSchema = z.string().trim().max(2_000).optional().default("");

const meetingSummaryActionItemSchema = z.object({
  task: z.string().trim().min(1).max(500),
  owner: z.string().trim().min(1).max(200).nullable(),
  deadline: z.string().trim().min(1).max(200).nullable(),
});

export const codingSolutionStructuredSchema = z.object({
  understanding: requiredMarkdownFieldSchema,
  approach: requiredMarkdownFieldSchema,
  solution: requiredMarkdownFieldSchema,
  notes: optionalMarkdownFieldSchema,
});

export const systemDesignSolutionStructuredSchema = z.object({
  understanding: requiredMarkdownFieldSchema,
  approach: requiredMarkdownFieldSchema,
  solution: requiredMarkdownFieldSchema,
  notes: optionalMarkdownFieldSchema,
});

export const writingSolutionStructuredSchema = z.object({
  intent: requiredMarkdownFieldSchema,
  draft: requiredMarkdownFieldSchema,
  notes: optionalMarkdownFieldSchema,
});

export const meetingSummaryStructuredSchema = z.object({
  summary: z.array(z.string().trim().min(1).max(500)).max(12),
  decisions: z.array(z.string().trim().min(1).max(500)).max(12),
  actionItems: z.array(meetingSummaryActionItemSchema).max(12),
  risks: z.array(z.string().trim().min(1).max(500)).max(12),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(12),
  notes: z.array(z.string().trim().min(1).max(500)).max(8).optional().default([]),
});

export const structuredSolutionMetadataSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("coding"),
    data: codingSolutionStructuredSchema,
  }),
  z.object({
    type: z.literal("system_design"),
    data: systemDesignSolutionStructuredSchema,
  }),
  z.object({
    type: z.literal("writing"),
    data: writingSolutionStructuredSchema,
  }),
  z.object({
    type: z.literal("meeting_summary"),
    data: meetingSummaryStructuredSchema,
  }),
]);

export const sessionSolutionStatusSchema = z.enum(sessionSolutionStatusValues);

export const sessionSolutionFormatSchema = z.enum(sessionSolutionFormatValues);

export const sessionSolutionEventTypeSchema = z.enum(sessionSolutionEventTypeValues);

export const sessionSolutionMetadataSchema = z
  .object({
    structured: structuredSolutionMetadataSchema,
  })
  .nullable();

export const sessionSolutionSchema = z.object({
  id: sessionSolutionIdSchema,
  sessionId: sessionIdSchema,
  status: sessionSolutionStatusSchema,
  format: sessionSolutionFormatSchema,
  content: z.string(),
  version: z.number().int().positive(),
  sourceEventSequence: z.number().int().nonnegative(),
  errorMessage: z.string().min(1).nullable(),
  provider: z.string().trim().min(1).max(128).nullable(),
  model: z.string().trim().min(1).max(256).nullable(),
  promptVersion: z.string().trim().min(1).max(128).nullable(),
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
  provider: z.string().trim().min(1).max(128).nullable(),
  model: z.string().trim().min(1).max(256).nullable(),
  promptVersion: z.string().trim().min(1).max(128).nullable(),
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
export type CodingSolutionStructured = z.infer<typeof codingSolutionStructuredSchema>;
export type SystemDesignSolutionStructured = z.infer<
  typeof systemDesignSolutionStructuredSchema
>;
export type WritingSolutionStructured = z.infer<typeof writingSolutionStructuredSchema>;
export type MeetingSummaryStructured = z.infer<typeof meetingSummaryStructuredSchema>;
export type StructuredSolutionMetadata = z.infer<typeof structuredSolutionMetadataSchema>;
export type SessionSolutionMetadata = z.infer<typeof sessionSolutionMetadataSchema>;
export type SessionSolution = z.infer<typeof sessionSolutionSchema>;
export type SessionSolutionEvent = z.infer<typeof sessionSolutionEventSchema>;
