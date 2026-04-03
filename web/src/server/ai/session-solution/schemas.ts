import { z } from "zod";

export const solutionPromptVersion = "v3";

const meetingSummaryActionItemSchema = z.object({
  task: z.string().trim().min(1).max(500),
  owner: z.string().trim().min(1).max(200).nullable(),
  deadline: z.string().trim().min(1).max(200).nullable(),
});

export const meetingSummaryStructuredSchema = z.object({
  summary: z.array(z.string().trim().min(1).max(500)).max(12),
  decisions: z.array(z.string().trim().min(1).max(500)).max(12),
  actionItems: z.array(meetingSummaryActionItemSchema).max(12),
  risks: z.array(z.string().trim().min(1).max(500)).max(12),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(12),
  notes: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type MeetingSummaryStructured = z.infer<typeof meetingSummaryStructuredSchema>;

export type GeneratedSolution = {
  content: string;
  format: "markdown";
  provider: string;
  model: string;
  promptVersion: string;
  meta: Record<string, unknown> | null;
};

export type SolutionPrompt = {
  system: string;
  prompt: string;
  outputMode: "markdown" | "meeting_summary_object";
};

export type SessionConstraintInstructions = {
  system: string[];
  prompt: string[];
};
