import type {
  SessionStatus,
} from "@/lib/contracts/session";

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
