import {
  generateObject,
} from "ai";

import type { SessionType } from "@/lib/contracts/session";
import type { SessionSolutionMetadata } from "@/lib/contracts/solution";
import { createOpenRouterClient } from "@/server/ai/openrouter";
import { buildSolutionPrompt } from "@/server/ai/session-solution/prompt";
import {
  renderBrainstormMarkdown,
  renderCodingSolutionMarkdown,
  renderMeetingMarkdown,
  renderSystemDesignSolutionMarkdown,
  renderWritingSolutionMarkdown,
} from "@/server/ai/session-solution/render";
import {
  type BrainstormStructured,
  type CodingSolutionStructured,
  type GeneratedSolution,
  getStructuredSolutionSchema,
  type MeetingStructured,
  type SystemDesignSolutionStructured,
  type SolutionPrompt,
  solutionPromptVersion,
  type WritingSolutionStructured,
} from "@/server/ai/session-solution/schemas";
import {
  buildTranscriptContext,
} from "@/server/ai/session-solution/transcript";
import { validateGeneratedSolution } from "@/server/ai/session-solution/validate";
import type { GenerateSessionSolutionInput } from "@/server/ai/session-solution/types";

type OpenRouterClient = ReturnType<typeof createOpenRouterClient>;
type OpenRouterModel = OpenRouterClient["model"];

type SessionSolutionGenerationError = Error & {
  provider: string;
  model: string;
  promptVersion: string;
};

function toGenerationError(
  error: unknown,
  config: { provider: string; modelId: string },
): SessionSolutionGenerationError {
  const base = error instanceof Error ? error : new Error("Unable to generate a solution.");

  return Object.assign(base, {
    provider: config.provider,
    model: config.modelId,
    promptVersion: solutionPromptVersion,
  });
}

function buildStructuredSolutionMeta(
  sessionType: SessionType,
  data:
    | BrainstormStructured
    | CodingSolutionStructured
    | SystemDesignSolutionStructured
    | WritingSolutionStructured
    | MeetingStructured,
): SessionSolutionMetadata {
  switch (sessionType) {
    case "coding":
      return {
        structured: {
          type: "coding",
          data: data as CodingSolutionStructured,
        },
      };
    case "system_design":
      return {
        structured: {
          type: "system_design",
          data: data as SystemDesignSolutionStructured,
        },
      };
    case "writing":
      return {
        structured: {
          type: "writing",
          data: data as WritingSolutionStructured,
        },
      };
    case "meeting":
      return {
        structured: {
          type: "meeting",
          data: data as MeetingStructured,
        },
      };
    case "brainstorm":
      return {
        structured: {
          type: "brainstorm",
          data: data as BrainstormStructured,
        },
      };
  }
}

function buildSolutionResult(
  config: { provider: string; modelId: string },
  content: string,
  meta: SessionSolutionMetadata,
): GeneratedSolution {
  return {
    content,
    format: "markdown",
    provider: config.provider,
    model: config.modelId,
    promptVersion: solutionPromptVersion,
    meta,
  };
}

function renderStructuredSolution(
  sessionType: SessionType,
  structured:
    | BrainstormStructured
    | CodingSolutionStructured
    | SystemDesignSolutionStructured
    | WritingSolutionStructured
    | MeetingStructured,
) {
  switch (sessionType) {
    case "coding":
      return renderCodingSolutionMarkdown(structured as CodingSolutionStructured);
    case "system_design":
      return renderSystemDesignSolutionMarkdown(
        structured as SystemDesignSolutionStructured,
      );
    case "writing":
      return renderWritingSolutionMarkdown(structured as WritingSolutionStructured);
    case "meeting":
      return renderMeetingMarkdown(structured as MeetingStructured);
    case "brainstorm":
      return renderBrainstormMarkdown(structured as BrainstormStructured);
  }
}

async function generateStructuredSolution(
  sessionType: SessionType,
  model: OpenRouterModel,
  config: { provider: string; modelId: string },
  prompt: SolutionPrompt,
): Promise<GeneratedSolution> {
  const schema = getStructuredSolutionSchema(sessionType);
  const { object } = await generateObject({
    model,
    schema,
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.2,
    maxOutputTokens: 1600,
  });

  const structured = schema.parse(object) as
    | BrainstormStructured
    | CodingSolutionStructured
    | SystemDesignSolutionStructured
    | WritingSolutionStructured
    | MeetingStructured;
  const content = validateGeneratedSolution(
    sessionType,
    renderStructuredSolution(sessionType, structured),
  );

  return buildSolutionResult(config, content, buildStructuredSolutionMeta(sessionType, structured));
}

export async function generateSessionSolution({
  session,
  transcriptEvents,
  previousSolutionContent,
}: GenerateSessionSolutionInput) {
  const summary = buildTranscriptContext(transcriptEvents);

  if (!summary.transcript.trim()) {
    throw new Error("Cannot generate a solution without finalized transcript content.");
  }

  const { model, config } = createOpenRouterClient();
  try {
    const prompt = buildSolutionPrompt(session, summary, {
      previousSolutionContent,
    });

    return await generateStructuredSolution(session.type, model, config, prompt);
  } catch (error) {
    throw toGenerationError(error, config);
  }
}

export { buildSolutionPrompt } from "@/server/ai/session-solution/prompt";
export {
  renderBrainstormMarkdown,
  renderCodingSolutionMarkdown,
  renderMeetingMarkdown,
  renderSystemDesignSolutionMarkdown,
  renderWritingSolutionMarkdown,
} from "@/server/ai/session-solution/render";
export {
  brainstormStructuredSchema,
  codingSolutionStructuredSchema,
  getStructuredSolutionSchema,
  meetingStructuredSchema,
  solutionPromptVersion,
  systemDesignSolutionStructuredSchema,
  writingSolutionStructuredSchema,
} from "@/server/ai/session-solution/schemas";
export {
  buildTranscriptContext,
  type TranscriptSummary,
} from "@/server/ai/session-solution/transcript";
export { validateGeneratedSolution } from "@/server/ai/session-solution/validate";
