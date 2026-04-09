import type { SessionType } from "@/lib/contracts/session";
import {
  codingSolutionStructuredSchema,
  meetingSummaryStructuredSchema,
  sessionSolutionMetadataSchema,
  systemDesignSolutionStructuredSchema,
  writingSolutionStructuredSchema,
  type CodingSolutionStructured,
  type MeetingSummaryStructured,
  type SessionSolutionMetadata,
  type SystemDesignSolutionStructured,
  type WritingSolutionStructured,
} from "@/lib/contracts/solution";

export const solutionPromptVersion = "v4";

export function getStructuredSolutionSchema(sessionType: SessionType) {
  switch (sessionType) {
    case "coding":
      return codingSolutionStructuredSchema;
    case "system_design":
      return systemDesignSolutionStructuredSchema;
    case "writing":
      return writingSolutionStructuredSchema;
    case "meeting_summary":
      return meetingSummaryStructuredSchema;
  }
}

export type GeneratedSolution = {
  content: string;
  format: "markdown";
  provider: string;
  model: string;
  promptVersion: string;
  meta: SessionSolutionMetadata;
};

export type SolutionPrompt = {
  system: string;
  prompt: string;
  outputMode: "session_object";
};

export type SessionConstraintInstructions = {
  system: string[];
  prompt: string[];
};

export {
  codingSolutionStructuredSchema,
  meetingSummaryStructuredSchema,
  sessionSolutionMetadataSchema,
  systemDesignSolutionStructuredSchema,
  writingSolutionStructuredSchema,
  type CodingSolutionStructured,
  type MeetingSummaryStructured,
  type SessionSolutionMetadata,
  type SystemDesignSolutionStructured,
  type WritingSolutionStructured,
};
