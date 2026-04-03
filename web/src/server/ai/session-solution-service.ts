import {
  generateObject,
  generateText,
} from "ai";

import type { SessionType } from "@/lib/contracts/session";
import { createOpenRouterClient } from "@/server/ai/openrouter";
import { buildSolutionPrompt } from "@/server/ai/session-solution/prompt";
import { renderMeetingSummaryMarkdown } from "@/server/ai/session-solution/render";
import {
  type GeneratedSolution,
  meetingSummaryStructuredSchema,
  type MeetingSummaryStructured,
  type SolutionPrompt,
  solutionPromptVersion,
} from "@/server/ai/session-solution/schemas";
import {
  buildTranscriptContext,
} from "@/server/ai/session-solution/transcript";
import { validateGeneratedSolution } from "@/server/ai/session-solution/validate";
import type { GenerateSessionSolutionInput } from "@/server/ai/session-solution/types";

type OpenRouterClient = ReturnType<typeof createOpenRouterClient>;
type OpenRouterModel = OpenRouterClient["model"];

function buildStructuredMeetingSummaryMeta(summary: MeetingSummaryStructured) {
  return {
    structured: {
      type: "meeting_summary",
      data: summary,
    },
  } satisfies Record<string, unknown>;
}

function buildSolutionResult(
  config: { provider: string; modelId: string },
  content: string,
  meta: Record<string, unknown> | null,
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

async function generateMeetingSummarySolution(
  model: OpenRouterModel,
  config: { provider: string; modelId: string },
  prompt: SolutionPrompt,
): Promise<GeneratedSolution> {
  const { object } = await generateObject({
    model,
    schema: meetingSummaryStructuredSchema,
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.2,
    maxOutputTokens: 1600,
  });

  const structured = meetingSummaryStructuredSchema.parse(object);
  const content = validateGeneratedSolution(
    "meeting_summary",
    renderMeetingSummaryMarkdown(structured),
  );

  return buildSolutionResult(
    config,
    content,
    buildStructuredMeetingSummaryMeta(structured),
  );
}

async function generateMarkdownSolution(
  sessionType: SessionType,
  model: OpenRouterModel,
  config: { provider: string; modelId: string },
  prompt: SolutionPrompt,
): Promise<GeneratedSolution> {
  const { text } = await generateText({
    model,
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.2,
    maxOutputTokens: 1600,
  });

  return buildSolutionResult(config, validateGeneratedSolution(sessionType, text), null);
}

export async function generateSessionSolution({
  session,
  transcriptEvents,
}: GenerateSessionSolutionInput) {
  const summary = buildTranscriptContext(transcriptEvents);

  if (!summary.transcript.trim()) {
    throw new Error("Cannot generate a solution without finalized transcript content.");
  }

  const { model, config } = createOpenRouterClient();
  const prompt = buildSolutionPrompt(session, summary);

  if (prompt.outputMode === "meeting_summary_object") {
    return generateMeetingSummarySolution(model, config, prompt);
  }

  return generateMarkdownSolution(session.type, model, config, prompt);
}

export { buildSolutionPrompt } from "@/server/ai/session-solution/prompt";
export { renderMeetingSummaryMarkdown } from "@/server/ai/session-solution/render";
export {
  meetingSummaryStructuredSchema,
  solutionPromptVersion,
} from "@/server/ai/session-solution/schemas";
export {
  buildTranscriptContext,
  type TranscriptSummary,
} from "@/server/ai/session-solution/transcript";
export { validateGeneratedSolution } from "@/server/ai/session-solution/validate";
