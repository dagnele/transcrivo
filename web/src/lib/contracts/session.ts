import { z } from "zod";

import { sessionAccessKindValues } from "@/lib/contracts/billing";

export const sessionStatusValues = ["draft", "live", "ended", "failed", "expired"] as const;

export const sessionSolutionGenerationStatusValues = [
  "idle",
  "debouncing",
  "generating",
] as const;

export const sessionTypeValues = [
  "coding",
  "system_design",
  "writing",
  "meeting_summary",
] as const;

export const sessionLanguageValues = [
  "python",
  "javascript",
  "typescript",
  "java",
  "cpp",
  "go",
  "rust",
  "csharp",
  "kotlin",
  "swift",
  "ruby",
  "php",
] as const;

export const sessionIdSchema = z.string().trim().min(1).max(128);

export const sessionStatusSchema = z.enum(sessionStatusValues);

export const sessionSolutionGenerationStatusSchema = z.enum(
  sessionSolutionGenerationStatusValues,
);

export const sessionTypeSchema = z.enum(sessionTypeValues);

export const sessionLanguageSchema = z.enum(sessionLanguageValues);

const sessionBaseSchema = z.object({
  title: z.string().min(1).max(160),
  type: sessionTypeSchema,
  language: sessionLanguageSchema.nullable(),
});

type SessionLanguageRefinementInput = {
  type: z.infer<typeof sessionTypeSchema>;
  language: z.infer<typeof sessionLanguageSchema> | null;
};

function refineSessionLanguage(
  value: SessionLanguageRefinementInput,
  ctx: z.RefinementCtx,
) {
  if (value.type === "coding" && value.language === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["language"],
      message: "Coding sessions require a language.",
    });
  }

  if (value.type !== "coding" && value.language !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["language"],
      message: "Only coding sessions can have a coding language.",
    });
  }
}

export const sessionAccessKindSchema = z.enum(sessionAccessKindValues);

export const sessionSchema = sessionBaseSchema
  .extend({
    id: sessionIdSchema,
    status: sessionStatusSchema,
    solutionEnabled: z.boolean(),
    solutionGenerationStatus: sessionSolutionGenerationStatusSchema,
    solutionGenerationStartedAt: z.date().nullable(),
    solutionGenerationDebounceUntil: z.date().nullable(),
    solutionGenerationMaxWaitUntil: z.date().nullable(),
    solutionGenerationSourceEventSequence: z.number().int().nonnegative().nullable(),
    accessKind: sessionAccessKindSchema.nullable(),
    trialEndsAt: z.date().nullable(),
    createdAt: z.date(),
    startedAt: z.date().nullable(),
    endedAt: z.date().nullable(),
    expiresAt: z.date().nullable(),
  })
  .superRefine(refineSessionLanguage);

export const createSessionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    type: sessionTypeSchema.default("coding"),
    language: sessionLanguageSchema.nullable().default(null),
  })
  .superRefine(refineSessionLanguage);

export const sessionIdInputSchema = z.object({
  sessionId: sessionIdSchema,
});

export const updateSessionInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    title: z.string().trim().min(1).max(100),
    type: sessionTypeSchema,
    language: sessionLanguageSchema.nullable(),
  })
  .superRefine(refineSessionLanguage);

export const listSessionsInputSchema = z.object({
  status: sessionStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime().optional(),
});

export const toggleSolutionInputSchema = z.object({
  sessionId: sessionIdSchema,
  enabled: z.boolean(),
});

export const paginatedSessionsSchema = z.object({
  items: z.array(sessionSchema),
  nextCursor: z.string().datetime().nullable(),
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionSolutionGenerationStatus = z.infer<
  typeof sessionSolutionGenerationStatusSchema
>;
export type SessionType = z.infer<typeof sessionTypeSchema>;
export type SessionLanguage = z.infer<typeof sessionLanguageSchema>;
export type SessionAccessKind = z.infer<typeof sessionAccessKindSchema>;
export type Session = z.infer<typeof sessionSchema>;
