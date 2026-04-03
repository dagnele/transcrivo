import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import {
  ingestSessionEventInputSchema,
  sessionEventSchema,
  transcriptEventPayloadSchema,
  type SessionEvent,
} from "@/lib/contracts/event";
import type { SessionStatus } from "@/lib/contracts/session";
import { generateBillingProfileId, generateRecordId } from "@/lib/ids";
import {
  getLastPublishedSessionSequence,
  publishSessionEvent,
} from "@/server/api/session-events";
import { scheduleSessionSolutionGeneration } from "@/server/ai/session-solution-worker";
import { db } from "@/server/db/client";
import { sessionEvents, sessions, userBillingProfiles } from "@/server/db/schema";
import { assignDraftSessionAccess } from "@/server/session-start-access";
import {
  assertSessionAcceptsCliTraffic,
  calculateSessionExpiresAt,
} from "@/server/session-lifecycle";
import { transcriptionLogger } from "@/server/logger";

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

  if (parsedInput.data.type === "session.started") {
    const parsedEvent = sessionEventSchema.parse(
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from ${sessions} where ${sessions.id} = ${parsedInput.data.sessionId} for update`,
        );

        const session = await tx.query.sessions.findFirst({
          where: eq(sessions.id, parsedInput.data.sessionId),
        });

        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Session not found.",
          });
        }

        if (session.status === "live" && session.accessKind) {
          const existingStartedEvent = await tx.query.sessionEvents.findFirst({
            where: and(
              eq(sessionEvents.sessionId, parsedInput.data.sessionId),
              eq(sessionEvents.type, "session.started"),
            ),
            orderBy: asc(sessionEvents.sequence),
          });

          if (existingStartedEvent) {
            return existingStartedEvent;
          }
        }

        if (session.status !== "draft") {
          await assertSessionAcceptsCliTraffic(session);
        }

        const latestEvent = await tx.query.sessionEvents.findFirst({
          where: eq(sessionEvents.sessionId, parsedInput.data.sessionId),
          orderBy: desc(sessionEvents.sequence),
        });

        const nextSequence =
          Math.max(
            latestEvent?.sequence ?? 0,
            getLastPublishedSessionSequence(parsedInput.data.sessionId),
          ) + 1;

        const pendingEvent = {
          id: generateRecordId(),
          sessionId: parsedInput.data.sessionId,
          sequence: nextSequence,
          type: parsedInput.data.type,
          createdAt: new Date(),
          payload: parsedInput.data.payload,
        };

        let sessionAccessKind = session.accessKind;
        let trialEndsAt = session.trialEndsAt;

        if (session.status === "draft") {
          await tx
            .insert(userBillingProfiles)
            .values({
              id: generateBillingProfileId(),
              userId: session.userId,
            })
            .onConflictDoNothing({ target: userBillingProfiles.userId });

          const profile = await tx.query.userBillingProfiles.findFirst({
            where: eq(userBillingProfiles.userId, session.userId),
          });

          if (!profile) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Billing profile unavailable.",
            });
          }

          const accessAssignment = await assignDraftSessionAccess({
            purchasedSessionCredits: profile.purchasedSessionCredits,
            trialUsedAt: profile.trialUsedAt,
            startedAt: pendingEvent.createdAt,
            consumePaidCredit: async () => {
              const [updatedProfile] = await tx
                .update(userBillingProfiles)
                .set({
                  purchasedSessionCredits: sql`${userBillingProfiles.purchasedSessionCredits} - 1`,
                  updatedAt: pendingEvent.createdAt,
                })
                .where(
                  and(
                    eq(userBillingProfiles.userId, session.userId),
                    gt(userBillingProfiles.purchasedSessionCredits, 0),
                  ),
                )
                .returning({ purchasedSessionCredits: userBillingProfiles.purchasedSessionCredits });

              return Boolean(updatedProfile);
            },
            consumeTrial: async () => {
              const [trialProfile] = await tx
                .update(userBillingProfiles)
                .set({
                  trialUsedAt: pendingEvent.createdAt,
                  updatedAt: pendingEvent.createdAt,
                })
                .where(
                  and(
                    eq(userBillingProfiles.userId, session.userId),
                    isNull(userBillingProfiles.trialUsedAt),
                  ),
                )
                .returning({ userId: userBillingProfiles.userId });

              return Boolean(trialProfile);
            },
          });

          sessionAccessKind = accessAssignment.accessKind;
          trialEndsAt = accessAssignment.trialEndsAt;

          await tx
            .update(sessions)
            .set({
              status: "live",
              accessKind: sessionAccessKind,
              startedAt: session.startedAt ?? pendingEvent.createdAt,
              endedAt: session.endedAt,
              expiresAt:
                session.expiresAt ??
                calculateSessionExpiresAt(
                  session.startedAt ?? pendingEvent.createdAt,
                  sessionAccessKind,
                ),
              trialEndsAt,
            })
            .where(eq(sessions.id, parsedInput.data.sessionId));
        }

        return (
          await tx
            .insert(sessionEvents)
            .values(pendingEvent)
            .returning()
        )[0];
      }),
    );

    publishSessionEvent(parsedEvent);
    return parsedEvent;
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

  const checkedSession = await assertSessionAcceptsCliTraffic(session);
  const now = new Date();

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

  if (
    parsedInput.data.type === "transcript.partial" ||
    parsedInput.data.type === "transcript.final"
  ) {
    transcriptionLogger?.debug(
      {
        sessionId: parsedInput.data.sessionId,
        eventType: parsedInput.data.type,
        transcript: parsedInput.data.payload,
        receivedAt: now.toISOString(),
      },
      "Transcript event received",
    );
  }

  const latestEvent = await db.query.sessionEvents.findFirst({
    where: eq(sessionEvents.sessionId, parsedInput.data.sessionId),
    orderBy: desc(sessionEvents.sequence),
  });

  const nextSequence =
    Math.max(latestEvent?.sequence ?? 0, getLastPublishedSessionSequence(parsedInput.data.sessionId)) + 1;

  const isPartialEvent = parsedInput.data.type === "transcript.partial";

  const nextStatus = getNextSessionStatus(session.status, parsedInput.data.type);

  const pendingEvent = {
    id: generateRecordId(),
    sessionId: parsedInput.data.sessionId,
    sequence: nextSequence,
    type: parsedInput.data.type,
    createdAt: now,
    payload: parsedInput.data.payload,
  };

  const event = isPartialEvent
    ? pendingEvent
    : (
        await db
          .insert(sessionEvents)
          .values(pendingEvent)
          .returning()
      )[0];

  if (!isPartialEvent && nextStatus !== checkedSession.status) {
    await db
      .update(sessions)
      .set({
        status: nextStatus,
        startedAt: checkedSession.startedAt,
        endedAt:
          parsedInput.data.type === "session.ended" ||
          parsedInput.data.type === "session.failed"
            ? event.createdAt
            : checkedSession.endedAt,
        expiresAt: checkedSession.expiresAt,
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
      await scheduleSessionSolutionGeneration(parsedEvent.sessionId, parsedEvent.sequence);
    }
  }

  return parsedEvent;
}
