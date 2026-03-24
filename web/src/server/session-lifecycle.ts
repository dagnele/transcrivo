import { and, desc, eq, lte, or } from "drizzle-orm";
import { generateRecordId } from "@/lib/ids";

import type { SessionStatus } from "@/lib/contracts/session";
import { createExpiredSessionReconciler } from "@/server/session-reconciliation";
import { db } from "@/server/db/client";
import { sessionEvents, sessions, type Session } from "@/server/db/schema";
import { getLastPublishedSessionSequence, publishSessionEvent } from "@/server/api/session-events";
import { sessionEventSchema } from "@/lib/contracts/event";

export const SESSION_DURATION_MS = 60 * 60 * 1000;
export const TRIAL_DURATION_MS = 5 * 60 * 1000;

const CLOSED_SESSION_STATUSES = new Set<SessionStatus>(["ended", "failed", "expired"]);

export class SessionStateError extends Error {
  constructor(
    message: string,
    readonly code: "session_expired" | "session_closed",
  ) {
    super(message);
    this.name = "SessionStateError";
  }
}

export function calculateSessionExpiresAt(startedAt: Date, accessKind?: string | null) {
  const duration = accessKind === "trial" ? TRIAL_DURATION_MS : SESSION_DURATION_MS;
  return new Date(startedAt.getTime() + duration);
}

export function isSessionExpired(
  session: Pick<Session, "startedAt" | "expiresAt">,
  now: Date = new Date(),
) {
  if (!session.startedAt || !session.expiresAt) {
    return false;
  }

  return session.expiresAt.getTime() <= now.getTime();
}

export async function expireSessionIfNeeded(
  session: Session,
  now: Date = new Date(),
): Promise<Session> {
  if (!isSessionExpired(session, now)) {
    // Also check trial-specific expiration via trialEndsAt
    if (
      session.accessKind === "trial" &&
      session.trialEndsAt &&
      session.trialEndsAt.getTime() <= now.getTime() &&
      session.status === "live"
    ) {
      // Trial time ran out — expire the session
      return expireTrialSession(session, now);
    }
    return session;
  }

  const endedAt = session.endedAt ?? session.expiresAt ?? now;

  if (session.status === "expired" && session.endedAt) {
    return session;
  }

  const [updatedSession] = await db
    .update(sessions)
    .set({
      status: "expired",
      endedAt,
    })
    .where(eq(sessions.id, session.id))
    .returning();

  if (session.status !== "expired") {
    const latestEvent = await db.query.sessionEvents.findFirst({
      where: eq(sessionEvents.sessionId, session.id),
      orderBy: desc(sessionEvents.sequence),
    });
    const nextSequence = Math.max(
      latestEvent?.sequence ?? 0,
      getLastPublishedSessionSequence(session.id),
    ) + 1;
    const [persistedEvent] = await db
      .insert(sessionEvents)
      .values({
        id: generateRecordId(),
        sessionId: session.id,
        sequence: nextSequence,
        type: "session.ended",
        createdAt: endedAt,
        payload: {
          reason: "session-expired",
        },
      })
      .returning();

    publishSessionEvent(sessionEventSchema.parse(persistedEvent));

  }

  return updatedSession ?? { ...session, status: "expired", endedAt };
}

async function expireTrialSession(
  session: Session,
  now: Date,
): Promise<Session> {
  const endedAt = session.trialEndsAt ?? now;

  const [updatedSession] = await db
    .update(sessions)
    .set({
      status: "expired",
      endedAt,
    })
    .where(eq(sessions.id, session.id))
    .returning();

  const latestEvent = await db.query.sessionEvents.findFirst({
    where: eq(sessionEvents.sessionId, session.id),
    orderBy: desc(sessionEvents.sequence),
  });
  const nextSequence = Math.max(
    latestEvent?.sequence ?? 0,
    getLastPublishedSessionSequence(session.id),
  ) + 1;
  const [persistedEvent] = await db
    .insert(sessionEvents)
    .values({
      id: generateRecordId(),
      sessionId: session.id,
      sequence: nextSequence,
      type: "session.ended",
      createdAt: endedAt,
      payload: {
        reason: "trial-expired",
      },
    })
    .returning();

  publishSessionEvent(sessionEventSchema.parse(persistedEvent));

  return updatedSession ?? { ...session, status: "expired", endedAt };
}

export async function assertSessionAcceptsCliTraffic(
  session: Session,
  now: Date = new Date(),
): Promise<Session> {
  const currentSession = await expireSessionIfNeeded(session, now);

  if (currentSession.status === "expired") {
    throw new SessionStateError("Session has expired.", "session_expired");
  }

  if (CLOSED_SESSION_STATUSES.has(currentSession.status)) {
    throw new SessionStateError("Session is already closed.", "session_closed");
  }

  return currentSession;
}

export const reconcileExpiredSessions = createExpiredSessionReconciler({
  async listExpiredLiveSessions(now) {
    return db.query.sessions.findMany({
      where: and(
        eq(sessions.status, "live"),
        or(
          lte(sessions.expiresAt, now),
          lte(sessions.trialEndsAt, now),
        ),
      ),
    });
  },
  expireSession: expireSessionIfNeeded,
});
