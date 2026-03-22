import { and, asc, desc, eq, lte } from "drizzle-orm";

import {
  solutionFailedPayloadSchema,
  solutionGeneratingPayloadSchema,
  solutionReadyPayloadSchema,
  type SessionSolutionEvent,
} from "@/lib/contracts/solution";
import { generateSessionSolutionId } from "@/lib/ids";
import {
  publishSessionSolutionEvent,
} from "@/server/api/session-events";
import { generateSessionSolution } from "@/server/ai/session-solution-service";
import { db } from "@/server/db/client";
import {
  sessionEvents,
  sessionSolutions,
  sessions,
} from "@/server/db/schema";

const DEBOUNCE_MS = 4000;

type SessionGenerationState = {
  timer: ReturnType<typeof setTimeout> | null;
  latestRequestedSequence: number;
  running: boolean;
};

const globalSessionSolutionWorker = globalThis as typeof globalThis & {
  __cheatcodeSessionSolutionWorker__?: Map<string, SessionGenerationState>;
};

const sessionGenerationState =
  globalSessionSolutionWorker.__cheatcodeSessionSolutionWorker__ ??
  (globalSessionSolutionWorker.__cheatcodeSessionSolutionWorker__ = new Map<
    string,
    SessionGenerationState
  >());

function getOrCreateState(sessionId: string): SessionGenerationState {
  const existing = sessionGenerationState.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: SessionGenerationState = {
    timer: null,
    latestRequestedSequence: 0,
    running: false,
  };

  sessionGenerationState.set(sessionId, created);
  return created;
}

function publishTypedSolutionEvent(event: SessionSolutionEvent) {
  publishSessionSolutionEvent(event);
}

async function runGeneration(sessionId: string, requestedSequence: number) {
  const state = getOrCreateState(sessionId);

  if (state.running) {
    return;
  }

  state.running = true;

  try {
    const [session, latestSolution] = await Promise.all([
      db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      }),
      db.query.sessionSolutions.findFirst({
        where: eq(sessionSolutions.sessionId, sessionId),
        orderBy: [desc(sessionSolutions.version), desc(sessionSolutions.createdAt)],
      }),
    ]);

    if (!session) {
      return;
    }

    if (!session.solutionEnabled) {
      return;
    }

    const transcriptEvents = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          lte(sessionEvents.sequence, requestedSequence),
        ),
      )
      .orderBy(asc(sessionEvents.sequence));

    const solutionId = generateSessionSolutionId();
    const version = (latestSolution?.version ?? 0) + 1;
    const generatedAt = new Date();

    publishTypedSolutionEvent({
      type: "solution.generating",
      payload: solutionGeneratingPayloadSchema.parse({
        solutionId,
        sessionId,
        version,
        status: "draft",
        format: "markdown",
        sourceEventSequence: requestedSequence,
        createdAt: generatedAt,
        provider: null,
        model: null,
        promptVersion: null,
        meta: null,
      }),
    });

    try {
      const generated = await generateSessionSolution({
        session,
        transcriptEvents,
      });

      const [persisted] = await db
        .insert(sessionSolutions)
        .values({
          id: solutionId,
          sessionId,
          status: "ready",
          format: generated.format,
          content: generated.content,
          version,
          sourceEventSequence: requestedSequence,
          provider: generated.provider,
          model: generated.model,
          promptVersion: generated.promptVersion,
          meta: null,
        })
        .returning();

      publishTypedSolutionEvent({
        type: "solution.ready",
        payload: solutionReadyPayloadSchema.parse({
          solutionId: persisted.id,
          sessionId: persisted.sessionId,
          version: persisted.version,
          status: "ready",
          format: persisted.format,
          content: persisted.content,
          sourceEventSequence: persisted.sourceEventSequence,
          createdAt: persisted.createdAt,
          provider: persisted.provider ?? null,
          model: persisted.model ?? null,
          promptVersion: persisted.promptVersion ?? null,
          meta: persisted.meta ?? null,
        }),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to generate a solution.";

      const [persisted] = await db
        .insert(sessionSolutions)
        .values({
          id: solutionId,
          sessionId,
          status: "error",
          format: "markdown",
          content: latestSolution?.content ?? "",
          version,
          sourceEventSequence: requestedSequence,
          errorMessage: message,
          provider: latestSolution?.provider ?? null,
          model: latestSolution?.model ?? null,
          promptVersion: latestSolution?.promptVersion ?? null,
          meta: latestSolution?.meta ?? null,
        })
        .returning();

      publishTypedSolutionEvent({
        type: "solution.failed",
        payload: solutionFailedPayloadSchema.parse({
          solutionId: persisted.id,
          sessionId: persisted.sessionId,
          version: persisted.version,
          status: "error",
          format: persisted.format,
          content: persisted.content,
          sourceEventSequence: persisted.sourceEventSequence,
          createdAt: persisted.createdAt,
          errorMessage: persisted.errorMessage ?? message,
          provider: persisted.provider ?? null,
          model: persisted.model ?? null,
          promptVersion: persisted.promptVersion ?? null,
          meta: persisted.meta ?? null,
        }),
      });
    }
  } finally {
    state.running = false;

    if (state.latestRequestedSequence > requestedSequence) {
      scheduleSessionSolutionGeneration(sessionId, state.latestRequestedSequence);
    }
  }
}

export function scheduleSessionSolutionGeneration(
  sessionId: string,
  sourceEventSequence: number,
) {
  const state = getOrCreateState(sessionId);

  state.latestRequestedSequence = Math.max(
    state.latestRequestedSequence,
    sourceEventSequence,
  );

  if (state.running) {
    return;
  }

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    void runGeneration(sessionId, state.latestRequestedSequence).catch((error) => {
      console.error("Session solution generation failed", {
        sessionId,
        error,
      });
    });
  }, DEBOUNCE_MS);
}
