import type {
  Session,
  SessionStatus,
} from "@/lib/contracts/session";
import type { TranscriptItem } from "@/components/sessions/session-transcript";
import type { SessionSolution } from "@/lib/contracts/solution";
import { getSessionTypeLabel, getSessionLanguageLabel } from "./session-config";

export function formatTimestamp(date: Date | null) {
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatCompactTimestamp(date: Date | null) {
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTimecode(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getStatusVariant(status: SessionStatus) {
  switch (status) {
    case "live":
      return "default" as const;
    case "expired":
      return "destructive" as const;
    case "ended":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    case "draft":
    default:
      return "outline" as const;
  }
}

export function getConnectionLabel(status: string) {
  switch (status) {
    case "connecting":
      return "connecting";
    case "pending":
      return "live";
    case "error":
      return "stream error";
    case "idle":
    default:
      return "idle";
  }
}

function formatTimecodeFull(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSpeakerLabelForExport(source: string, sessionType: string): string {
  if (source === "mic") return "You";
  if (source === "system") {
    if (sessionType === "writing") return "Reference";
    if (sessionType === "meeting" || sessionType === "brainstorm") return "Participant";
    return "Interviewer";
  }
  return source;
}

export function generateSessionMarkdown(
  session: Session,
  transcriptItems: TranscriptItem[],
  solution: SessionSolution | null,
): string {
  const lines: string[] = [];

  lines.push(`# ${session.title}`);
  lines.push("");
  lines.push("- **Type**: " + getSessionTypeLabel(session.type));
  if (session.type === "coding" && session.language) {
    lines[lines.length - 1] += " / " + getSessionLanguageLabel(session.language);
  }
  lines.push("- **Created**: " + formatTimestamp(session.createdAt));
  if (session.startedAt) {
    lines.push("- **Started**: " + formatTimestamp(session.startedAt));
  }
  if (session.endedAt) {
    lines.push("- **Ended**: " + formatTimestamp(session.endedAt));
  }
  lines.push(`- **Status**: ${session.status}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (transcriptItems.length > 0) {
    lines.push("## Transcript");
    lines.push("");

    for (const item of transcriptItems) {
      if (item.status === "partial") continue;

      const speaker = getSpeakerLabelForExport(item.source, session.type);
      const timecode = formatTimecodeFull(item.startMs);
      lines.push(`### ${speaker} [${timecode}]`);
      lines.push("");
      lines.push(item.text);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  if (solution?.content) {
    lines.push("## Solution");
    lines.push("");
    lines.push(solution.content);
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadSessionMarkdown(
  session: Session,
  transcriptItems: TranscriptItem[],
  solution: SessionSolution | null,
): void {
  const markdown = generateSessionMarkdown(session, transcriptItems, solution);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);

  const filename = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") + ".md";

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
