import {
  transcriptEventPayloadSchema,
  type SessionEvent,
} from "@/lib/contracts/event";
import type { SessionType } from "@/lib/contracts/session";

export type TranscriptItem = {
  id: string;
  utteranceId: string;
  sequence: number;
  speaker: string;
  source: string;
  text: string;
  status: "partial" | "final";
  startMs: number;
  endMs: number;
};

export function mergeTranscriptItem(
  transcript: TranscriptItem[],
  nextItem: TranscriptItem,
) {
  const exactMatchIndex = transcript.findIndex(
    (item) => item.sequence === nextItem.sequence || item.id === nextItem.id,
  );

  if (exactMatchIndex >= 0) {
    const nextTranscript = [...transcript];
    nextTranscript[exactMatchIndex] = nextItem;
    nextTranscript.sort((left, right) => left.sequence - right.sequence);
    return nextTranscript;
  }

  const sameUtteranceIndex = transcript.findIndex(
    (item) => item.utteranceId === nextItem.utteranceId,
  );

  if (sameUtteranceIndex >= 0) {
    const nextTranscript = [...transcript];
    nextTranscript[sameUtteranceIndex] = nextItem;
    nextTranscript.sort((left, right) => left.sequence - right.sequence);
    return nextTranscript;
  }

  const usesStableUtteranceId = nextItem.utteranceId.startsWith("utt_");

  if (usesStableUtteranceId) {
    const nextTranscript = [...transcript, nextItem];
    nextTranscript.sort((left, right) => left.sequence - right.sequence);
    return nextTranscript;
  }

  const overlapsSameSourcePartial = (item: TranscriptItem) =>
    item.status === "partial" &&
    item.source === nextItem.source &&
    item.startMs <= nextItem.endMs &&
    item.endMs >= nextItem.startMs;

  const existingIndex = transcript.findIndex(overlapsSameSourcePartial);

  if (existingIndex >= 0) {
    const nextTranscript = [...transcript];
    nextTranscript[existingIndex] = nextItem;
    nextTranscript.sort((left, right) => left.sequence - right.sequence);
    return nextTranscript;
  } else {
    const nextTranscript = [...transcript, nextItem];
    nextTranscript.sort((left, right) => left.sequence - right.sequence);
    return nextTranscript;
  }
}

export function isTranscriptEvent(event: SessionEvent) {
  return event.type === "transcript.partial" || event.type === "transcript.final";
}

export function getTranscriptItemFromEvent(event: SessionEvent) {
  if (!isTranscriptEvent(event)) {
    return null;
  }

  const payload = transcriptEventPayloadSchema.safeParse(event.payload);

  if (!payload.success) {
    return null;
  }

  return {
    id: event.id,
    utteranceId: payload.data.utteranceId,
    sequence: event.sequence,
    speaker: payload.data.speaker,
    source: payload.data.source,
    text: payload.data.text,
    status: event.type === "transcript.final" ? "final" : "partial",
    startMs: payload.data.startMs,
    endMs: payload.data.endMs,
  } satisfies TranscriptItem;
}

export function normalizeTranscriptEvents(events: SessionEvent[]): TranscriptItem[] {
  return events.reduce<TranscriptItem[]>((transcript, event) => {
    const nextItem = getTranscriptItemFromEvent(event);

    if (!nextItem) {
      return transcript;
    }

    return mergeTranscriptItem(transcript, nextItem);
  }, []);
}

export function mergeTranscriptWindows(
  olderItems: TranscriptItem[],
  newerItems: TranscriptItem[],
) {
  return newerItems.reduce<TranscriptItem[]>(mergeTranscriptItem, olderItems);
}

function getSystemSpeakerLabel(sessionType: SessionType) {
  if (sessionType === "writing") return "Reference";
  if (sessionType === "meeting_summary") return "Participant";
  return "Interviewer";
}

export function getSpeakerLabel(sessionType: SessionType, source: string, speaker: string) {
  if (source === "mic") return "You";
  if (source === "system") return getSystemSpeakerLabel(sessionType);
  return speaker;
}
