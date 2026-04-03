import { transcriptEventPayloadSchema } from "@/lib/contracts/event";
import type { SessionEvent } from "@/server/db/schema";

export type TranscriptSummary = {
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

export function buildTranscriptContext(events: SessionEvent[]): TranscriptSummary {
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
