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
  micTurns: number;
  systemTurns: number;
  latestMicMessage: string | null;
  latestSystemMessage: string | null;
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
  let micTurns = 0;
  let systemTurns = 0;
  let latestMicMessage: string | null = null;
  let latestSystemMessage: string | null = null;

  const transcript = events
    .filter((event) => event.type === "transcript.final")
    .map((event) => {
      const parsed = transcriptEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        return null;
      }

      finalEventCount += 1;

      const speaker = parsed.data.source === "mic" ? "Speaker" : "System";

      if (speaker === "Speaker") {
        micTurns += 1;
        latestMicMessage = parsed.data.text;
      } else {
        systemTurns += 1;
        latestSystemMessage = parsed.data.text;
      }

      return `[${speaker} ${formatTimestamp(parsed.data.startMs)}-${formatTimestamp(parsed.data.endMs)}] ${parsed.data.text}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  return {
    transcript,
    finalEventCount,
    micTurns,
    systemTurns,
    latestMicMessage,
    latestSystemMessage,
  };
}

function inferSessionIntent(sessionTitle: string) {
  const normalized = sessionTitle.toLowerCase();

  if (normalized.includes("meeting") || normalized.includes("sync")) {
    return "meeting notes";
  }

  if (normalized.includes("write") || normalized.includes("draft")) {
    return "drafting assistance";
  }

  if (normalized.includes("frontend") || normalized.includes("react")) {
    return "frontend work";
  }

  if (normalized.includes("backend") || normalized.includes("api")) {
    return "backend work";
  }

  if (normalized.includes("algorithm") || normalized.includes("leetcode")) {
    return "algorithmic problem solving";
  }

  if (normalized.includes("system design")) {
    return "system design work";
  }

  return "technical work";
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

  if (session.type === "writing") {
    return {
      system: [
        "This is a writing session.",
        "Infer the likely writing goal from the transcript and produce polished written output.",
        "Do not merely summarize the transcript; turn it into useful prose.",
        "Preserve the speaker's likely intent and tone when reasonably clear.",
      ],
      prompt: [
        `Session type: ${getSessionTypeLabel(session.type)}`,
        "Session coding language: none",
        "Turn the spoken transcript into clear written output.",
        "If the transcript is ambiguous, state the most likely intent briefly before drafting.",
      ],
    };
  }

  if (session.type === "meeting_summary") {
    return {
      system: [
        "This is a meeting summary session.",
        "Extract structured notes from the transcript instead of writing a solution.",
        "Prefer explicit facts from the transcript over unsupported inference.",
        "List decisions, action items, risks, and open questions only when they are supported by the transcript.",
      ],
      prompt: [
        `Session type: ${getSessionTypeLabel(session.type)}`,
        "Session coding language: none",
        "Turn the transcript into concise, operational meeting notes.",
        "Avoid inventing deadlines, owners, or commitments that are not stated.",
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
  const latestSpeakerMessage = summary.latestMicMessage ?? "No explicit spoken input captured yet.";
  const latestSystemMessage =
    summary.latestSystemMessage ?? "No explicit system-side transcript captured yet.";
  const sessionConstraints = getSessionConstraintInstructions(session);

  const basePrompt = [
    `Session title: ${session.title}`,
    ...sessionConstraints.prompt,
    `Intent hint: ${sessionIntent}`,
    `Final transcript turns captured: ${summary.finalEventCount}`,
    `Speaker turns: ${summary.micTurns}`,
    `System turns: ${summary.systemTurns}`,
    "",
    "Latest speaker input:",
    latestSpeakerMessage,
    "",
    "Latest system transcript:",
    latestSystemMessage,
    "",
    "Transcript:",
    summary.transcript,
    "",
  ];

  if (session.type === "writing") {
    return {
      system: [
        "You help turn spoken thoughts into clear written output.",
        "Return only Markdown.",
        "Do not use raw HTML.",
        "Do not reveal hidden chain-of-thought.",
        "Be practical, concise, and directly useful.",
        "Prefer short sections with headings.",
        ...sessionConstraints.system,
        "If the transcript is incomplete, make the best reasonable inference and say so briefly.",
      ].join(" "),
      prompt: [
        ...basePrompt,
        "Produce Markdown with this shape:",
        "1. ## Intent",
        "2. ## Draft",
        "3. ## Notes",
        "",
        "Rules:",
        "- Keep each section concise and scannable.",
        "- In ## Intent, state what you believe the speaker is trying to write.",
        "- In ## Draft, provide polished, usable text rather than bullet fragments unless the transcript clearly calls for an outline.",
        "- In ## Notes, call out missing context, assumptions, or suggested next improvements briefly.",
      ].join("\n"),
    };
  }

  if (session.type === "meeting_summary") {
    return {
      system: [
        "You convert spoken conversation into structured meeting notes.",
        "Return only Markdown.",
        "Do not use raw HTML.",
        "Do not reveal hidden chain-of-thought.",
        "Be practical, concise, and directly useful.",
        "Prefer short sections with headings.",
        ...sessionConstraints.system,
        "If the transcript is incomplete, make the best reasonable inference and say so briefly.",
      ].join(" "),
      prompt: [
        ...basePrompt,
        "Produce Markdown with this shape:",
        "1. ## Summary",
        "2. ## Decisions",
        "3. ## Action Items",
        "4. ## Risks / Blockers",
        "5. ## Open Questions",
        "",
        "Rules:",
        "- Keep each section concise and scannable.",
        "- Use bullets where appropriate.",
        "- If a section has no support in the transcript, say `None captured.` instead of inventing details.",
        "- Include owners or deadlines only when they are explicitly stated or strongly implied by the transcript.",
      ].join("\n"),
    };
  }

  return {
    system: [
      "You are helping during a live technical session.",
      "Return only Markdown.",
      "Do not use raw HTML.",
      "Do not reveal hidden chain-of-thought.",
      "Be practical, concise, and directly useful.",
      "Prefer short sections with headings.",
      ...sessionConstraints.system,
      "If the transcript is incomplete, make the best reasonable inference and say so briefly.",
    ].join(" "),
    prompt: [
      ...basePrompt,
      "Produce Markdown with this shape:",
      "1. ## Understanding",
      "2. ## Approach",
      "3. ## Solution",
      "4. ## Notes",
      "",
      "Rules:",
      "- Keep each section concise and scannable.",
      "- Tailor the answer to what the transcript seems to be asking for.",
      "- Prefer one strong solution over multiple scattered alternatives.",
      "- Include code only when it materially helps.",
      "- If code is included, keep it concise and explain key tradeoffs briefly.",
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
