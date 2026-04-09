import type { SessionType } from "@/lib/contracts/session";
import {
  brainstormStructuredSchema,
  codingSolutionStructuredSchema,
  meetingStructuredSchema,
  sessionSolutionMetadataSchema,
  systemDesignSolutionStructuredSchema,
  writingSolutionStructuredSchema,
  type BrainstormStructured,
  type CodingSolutionStructured,
  type MeetingStructured,
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
    case "meeting":
      return meetingStructuredSchema;
    case "brainstorm":
      return brainstormStructuredSchema;
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
  brainstormStructuredSchema,
  codingSolutionStructuredSchema,
  meetingStructuredSchema,
  sessionSolutionMetadataSchema,
  systemDesignSolutionStructuredSchema,
  writingSolutionStructuredSchema,
  type BrainstormStructured,
  type CodingSolutionStructured,
  type MeetingStructured,
  type SessionSolutionMetadata,
  type SystemDesignSolutionStructured,
  type WritingSolutionStructured,
};
