import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  ingestSessionEventInputSchema,
  sessionEventSchema,
  transcriptEventPayloadSchema,
  type SessionEvent,
} from "@/lib/contracts/event";
import type { SessionStatus } from "@/lib/contracts/session";
import { generateRecordId } from "@/lib/ids";
import {
  getLastPublishedSessionSequence,
  publishSessionEvent,
} from "@/server/api/session-events";
import { scheduleSessionSolutionGeneration } from "@/server/ai/session-solution-worker";
import { db } from "@/server/db/client";
import { sessionEvents, sessions } from "@/server/db/schema";
import {
  assertSessionAcceptsCliTraffic,
  calculateSessionExpiresAt,
} from "@/server/session-lifecycle";

function getNextSessionStatus(
  currentStatus: SessionStatus,
  eventType: SessionEvent["type"],
): SessionStatus {
  switch (eventType) {
    case "session.started":
      return "live";
    case "session.ended":
      return "ended";
    case "session.failed":
      return "failed";
    default:
      return currentStatus;
  }
}

export async function ingestSessionEvent(input: unknown) {
  const parsedInput = ingestSessionEventInputSchema.safeParse(input);

  if (!parsedInput.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid session event payload.",
      cause: parsedInput.error,
    });
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, parsedInput.data.sessionId),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found.",
    });
  }

  const checkedSession =
    parsedInput.data.type === "session.started"
      ? session
      : await assertSessionAcceptsCliTraffic(session);

  if (
    (parsedInput.data.type === "transcript.partial" ||
      parsedInput.data.type === "transcript.final") &&
    !transcriptEventPayloadSchema.safeParse(parsedInput.data.payload).success
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Transcript events require a transcript payload.",
    });
  }

  const latestEvent = await db.query.sessionEvents.findFirst({
    where: eq(sessionEvents.sessionId, parsedInput.data.sessionId),
    orderBy: desc(sessionEvents.sequence),
  });

  const nextSequence =
    Math.max(latestEvent?.sequence ?? 0, getLastPublishedSessionSequence(parsedInput.data.sessionId)) + 1;

  const isPartialEvent = parsedInput.data.type === "transcript.partial";
  const now = new Date();

  const event = isPartialEvent
    ? {
        id: generateRecordId(),
        sessionId: parsedInput.data.sessionId,
        sequence: nextSequence,
        type: parsedInput.data.type,
        createdAt: now,
        payload: parsedInput.data.payload,
      }
    : (
        await db
          .insert(sessionEvents)
          .values({
            id: generateRecordId(),
            sessionId: parsedInput.data.sessionId,
            sequence: nextSequence,
            type: parsedInput.data.type,
            payload: parsedInput.data.payload,
          })
          .returning()
      )[0];

  const nextStatus = getNextSessionStatus(session.status, parsedInput.data.type);

  if (
    !isPartialEvent &&
    (nextStatus !== checkedSession.status || parsedInput.data.type === "session.started")
  ) {
    const startedAt =
      parsedInput.data.type === "session.started"
        ? checkedSession.startedAt ?? event.createdAt
        : checkedSession.startedAt;
    const expiresAt =
      parsedInput.data.type === "session.started"
        ? checkedSession.expiresAt ?? calculateSessionExpiresAt(startedAt ?? event.createdAt)
        : checkedSession.expiresAt;

    await db
      .update(sessions)
      .set({
        status: nextStatus,
        startedAt,
        endedAt:
          parsedInput.data.type === "session.ended" ||
          parsedInput.data.type === "session.failed"
            ? event.createdAt
            : checkedSession.endedAt,
        expiresAt,
      })
      .where(eq(sessions.id, parsedInput.data.sessionId));
  }

  const parsedEvent = sessionEventSchema.parse(event);
  publishSessionEvent(parsedEvent);

  if (parsedEvent.type === "transcript.final") {
    const currentSession = await db.query.sessions.findFirst({
      where: eq(sessions.id, parsedEvent.sessionId),
      columns: { solutionEnabled: true },
    });

    if (currentSession?.solutionEnabled !== false) {
      scheduleSessionSolutionGeneration(parsedEvent.sessionId, parsedEvent.sequence);
    }
  }

  return parsedEvent;
}
