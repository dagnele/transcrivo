import { generateText } from "ai";

import { transcriptEventPayloadSchema } from "@/lib/contracts/event";
import type { Session } from "@/lib/contracts/session";
import {
  getSessionLanguageLabel,
  getSessionTypeLabel,
} from "@/lib/session-config";
import { createOpenRouterClient } from "@/server/ai/openrouter";
import type { SessionEvent } from "@/server/db/schema";

const solutionPromptVersion = "v1";

type TranscriptSummary = {
  transcript: string;
  finalEventCount: number;
  candidateTurns: number;
  interviewerTurns: number;
  latestCandidateMessage: string | null;
  latestInterviewerMessage: string | null;
};

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function buildTranscriptContext(events: SessionEvent[]): TranscriptSummary {
  let finalEventCount = 0;
  let candidateTurns = 0;
  let interviewerTurns = 0;
  let latestCandidateMessage: string | null = null;
  let latestInterviewerMessage: string | null = null;

  const transcript = events
    .filter((event) => event.type === "transcript.final")
    .map((event) => {
      const parsed = transcriptEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        return null;
      }

      finalEventCount += 1;

      const speaker = parsed.data.source === "mic" ? "Candidate" : "Interviewer";

      if (speaker === "Candidate") {
        candidateTurns += 1;
        latestCandidateMessage = parsed.data.text;
      } else {
        interviewerTurns += 1;
        latestInterviewerMessage = parsed.data.text;
      }

      return `[${speaker} ${formatTimestamp(parsed.data.startMs)}-${formatTimestamp(parsed.data.endMs)}] ${parsed.data.text}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    transcript,
    finalEventCount,
    candidateTurns,
    interviewerTurns,
    latestCandidateMessage,
    latestInterviewerMessage,
  };
}

function inferSessionIntent(sessionTitle: string) {
  const normalized = sessionTitle.toLowerCase();

  if (normalized.includes("frontend") || normalized.includes("react")) {
    return "frontend interview";
  }

  if (normalized.includes("backend") || normalized.includes("api")) {
    return "backend interview";
  }

  if (normalized.includes("algorithm") || normalized.includes("leetcode")) {
    return "algorithmic interview";
  }

  if (normalized.includes("system design")) {
    return "system design interview";
  }

  return "technical interview";
}

function getSessionConstraintInstructions(session: Session) {
  if (session.type === "system_design") {
    return {
      system: [
        "This is a system design session.",
        "Do not force the answer into a programming-language implementation unless the transcript explicitly asks for one.",
        "Prefer architecture, tradeoffs, scaling concerns, APIs, data modeling, and operational details.",
        "Include Mermaid diagrams (```mermaid fenced code blocks) to illustrate architecture, data flow, or component relationships.",
        "Use flowchart, sequence, or C4Context diagrams as appropriate.",
      ],
      prompt: [
        `Session type: ${getSessionTypeLabel(session.type)}`,
        "Session coding language: none",
        "Focus on system design reasoning instead of code by default.",
        "Include at least one Mermaid diagram showing the high-level architecture or data flow.",
      ],
    };
  }

  if (session.language === null) {
    throw new Error("Coding sessions require a language before generating a solution.");
  }

  const solutionLanguage = getSessionLanguageLabel(session.language);

  return {
    system: [
      `This is a ${getSessionTypeLabel(session.type).toLowerCase()} session.`,
      `The session is bound to ${solutionLanguage}; all code examples and the primary solution must use ${solutionLanguage}.`,
      `Use fenced code blocks tagged as ${session.language} when code is included.`,
    ],
    prompt: [
      `Session type: ${getSessionTypeLabel(session.type)}`,
      `Session coding language: ${solutionLanguage} (${session.language})`,
      `Use ${solutionLanguage} for the primary solution and any code snippets.`,
    ],
  };
}

function buildSolutionPrompt(
  session: Session,
  summary: TranscriptSummary,
) {
  const sessionIntent = inferSessionIntent(session.title);
  const latestCandidateMessage =
    summary.latestCandidateMessage ?? "No explicit candidate answer yet.";
  const latestInterviewerMessage =
    summary.latestInterviewerMessage ?? "No explicit interviewer prompt captured yet.";
  const sessionConstraints = getSessionConstraintInstructions(session);

  return {
    system: [
      "You are helping a candidate during a live mock technical interview.",
      "Return only Markdown.",
      "Do not use raw HTML.",
      "Do not reveal hidden chain-of-thought.",
      "Be practical, concise, and directly useful during the interview.",
      "Prefer short sections with headings.",
      ...sessionConstraints.system,
      "If the transcript is incomplete, make the best reasonable inference and say so briefly.",
    ].join(" "),
    prompt: [
      `Session title: ${session.title}`,
      ...sessionConstraints.prompt,
      `Interview type hint: ${sessionIntent}`,
      `Final transcript turns captured: ${summary.finalEventCount}`,
      `Candidate turns: ${summary.candidateTurns}`,
      `Interviewer turns: ${summary.interviewerTurns}`,
      "",
      "Latest interviewer prompt:",
      latestInterviewerMessage,
      "",
      "Latest candidate response:",
      latestCandidateMessage,
      "",
      "Transcript:",
      summary.transcript,
      "",
      "Produce a mock interview solution in Markdown with this shape:",
      "1. ## Understanding",
      "2. ## Approach",
      "3. ## Solution",
      "4. ## Notes",
      "",
      "Rules:",
      "- Keep each section concise and scannable.",
      "- Tailor the answer to what the interviewer seems to be asking.",
      "- Prefer one strong solution over multiple scattered alternatives.",
      "- Include code only when it materially helps the candidate.",
      "- If code is included, keep it interview-ready and explain key tradeoffs briefly.",
    ].join("\n"),
  };
}

export type GenerateSessionSolutionInput = {
  session: Session;
  transcriptEvents: SessionEvent[];
};

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

  const { text } = await generateText({
    model,
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.2,
    maxOutputTokens: 1600,
  });

  const content = text.trim();

  if (!content) {
    throw new Error("The AI provider returned an empty solution.");
  }

  return {
    content,
    format: "markdown" as const,
    provider: config.provider,
    model: config.modelId,
    promptVersion: solutionPromptVersion,
  };
}
