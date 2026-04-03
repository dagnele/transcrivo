import { and, asc, desc, eq, gt, lte } from "drizzle-orm";

import {
  solutionFailedPayloadSchema,
  solutionGeneratingPayloadSchema,
  solutionReadyPayloadSchema,
  type SessionSolutionEvent,
} from "@/lib/contracts/solution";
import { generateSessionSolutionId } from "@/lib/ids";
import { publishSessionSolutionEvent } from "@/server/api/session-events";
import { generateSessionSolution } from "@/server/ai/session-solution-service";
import { db } from "@/server/db/client";
import { sessionEvents, sessionSolutions, sessions } from "@/server/db/schema";
import { createLogger } from "@/server/logger";

const logger = createLogger("session-solution-worker");

const DEBOUNCE_MS = 5000;
const MAX_WAIT_MS = 10000;

type SessionGenerationState = {
  timer: ReturnType<typeof setTimeout> | null;
  firstScheduledAt: number | null;
  latestRequestedSequence: number;
  running: boolean;
  discardRunningResult: boolean;
};

const globalSessionSolutionWorker = globalThis as typeof globalThis & {
  __transcrivoSessionSolutionWorker__?: Map<string, SessionGenerationState>;
};

const sessionGenerationState =
  globalSessionSolutionWorker.__transcrivoSessionSolutionWorker__ ??
  (globalSessionSolutionWorker.__transcrivoSessionSolutionWorker__ = new Map<
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
    firstScheduledAt: null,
    latestRequestedSequence: 0,
    running: false,
    discardRunningResult: false,
  };

  sessionGenerationState.set(sessionId, created);
  return created;
}

function publishTypedSolutionEvent(event: SessionSolutionEvent) {
  publishSessionSolutionEvent(event);
}

async function persistIdleGenerationState(sessionId: string) {
  await db
    .update(sessions)
    .set({
      solutionGenerationStatus: "idle",
      solutionGenerationStartedAt: null,
      solutionGenerationDebounceUntil: null,
      solutionGenerationMaxWaitUntil: null,
      solutionGenerationSourceEventSequence: null,
    })
    .where(eq(sessions.id, sessionId));
}

async function persistDebouncingGenerationState(
  sessionId: string,
  debounceUntil: Date,
  maxWaitUntil: Date,
  sourceEventSequence: number,
) {
  await db
    .update(sessions)
    .set({
      solutionGenerationStatus: "debouncing",
      solutionGenerationStartedAt: null,
      solutionGenerationDebounceUntil: debounceUntil,
      solutionGenerationMaxWaitUntil: maxWaitUntil,
      solutionGenerationSourceEventSequence: sourceEventSequence,
    })
    .where(eq(sessions.id, sessionId));
}

async function persistGeneratingGenerationState(
  sessionId: string,
  requestedSequence: number,
  startedAt: Date,
) {
  await db
    .update(sessions)
    .set({
      solutionGenerationStatus: "generating",
      solutionGenerationStartedAt: startedAt,
      solutionGenerationDebounceUntil: null,
      solutionGenerationMaxWaitUntil: null,
      solutionGenerationSourceEventSequence: requestedSequence,
    })
    .where(eq(sessions.id, sessionId));
}

function clearScheduledTimer(state: SessionGenerationState) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  state.firstScheduledAt = null;
}

type AttemptMetadata = {
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
};

function getAttemptMetadata(error: unknown): AttemptMetadata {
  if (typeof error !== "object" || error === null) {
    return { provider: null, model: null, promptVersion: null };
  }

  const candidate = error as {
    provider?: unknown;
    model?: unknown;
    promptVersion?: unknown;
  };

  return {
    provider: typeof candidate.provider === "string" ? candidate.provider : null,
    model: typeof candidate.model === "string" ? candidate.model : null,
    promptVersion:
      typeof candidate.promptVersion === "string" ? candidate.promptVersion : null,
  };
}

async function runGeneration(sessionId: string, requestedSequence: number) {
  const state = getOrCreateState(sessionId);

  if (state.running) {
    return;
  }

  state.running = true;
  state.discardRunningResult = false;

  const startedAt = new Date();
  let shouldScheduleFollowUp = false;
  let allowFollowUpScheduling = false;

  try {
    await persistGeneratingGenerationState(sessionId, requestedSequence, startedAt);

    const [session, latestPersistedSolution, latestReadySolution] = await Promise.all([
      db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      }),
      db.query.sessionSolutions.findFirst({
        where: eq(sessionSolutions.sessionId, sessionId),
        orderBy: [desc(sessionSolutions.version), desc(sessionSolutions.createdAt)],
      }),
      db.query.sessionSolutions.findFirst({
        where: and(
          eq(sessionSolutions.sessionId, sessionId),
          eq(sessionSolutions.status, "ready"),
        ),
        orderBy: [desc(sessionSolutions.version), desc(sessionSolutions.createdAt)],
      }),
    ]);

    if (!session) {
      return;
    }

    if (!session.solutionEnabled) {
      return;
    }

    allowFollowUpScheduling = true;

    if (
      latestReadySolution &&
      requestedSequence <= latestReadySolution.sourceEventSequence
    ) {
      return;
    }

    const transcriptEvents = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          eq(sessionEvents.type, "transcript.final"),
          latestReadySolution
            ? gt(sessionEvents.sequence, latestReadySolution.sourceEventSequence)
            : undefined,
          lte(sessionEvents.sequence, requestedSequence),
        ),
      )
      .orderBy(asc(sessionEvents.sequence));

    if (transcriptEvents.length === 0) {
      return;
    }

    const solutionId = generateSessionSolutionId();
    const version = (latestPersistedSolution?.version ?? 0) + 1;
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
        previousSolutionContent: latestReadySolution?.content ?? null,
      });

      const currentSession = await db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
        columns: { solutionEnabled: true },
      });

      if (!currentSession?.solutionEnabled || state.discardRunningResult) {
        return;
      }

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
          meta: generated.meta,
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
      if (state.discardRunningResult) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unable to generate a solution.";
      const attempt = getAttemptMetadata(error);

      const [persisted] = await db
        .insert(sessionSolutions)
        .values({
          id: solutionId,
          sessionId,
          status: "error",
          format: "markdown",
          content: latestReadySolution?.content ?? "",
          version,
          sourceEventSequence: requestedSequence,
          errorMessage: message,
          provider: attempt.provider,
          model: attempt.model,
          promptVersion: attempt.promptVersion,
          meta: null,
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
    const discardRunningResult = state.discardRunningResult;
    shouldScheduleFollowUp = state.latestRequestedSequence > requestedSequence;

    state.running = false;
    state.discardRunningResult = false;

    await persistIdleGenerationState(sessionId);

    if (allowFollowUpScheduling && !discardRunningResult && shouldScheduleFollowUp) {
      await scheduleSessionSolutionGeneration(sessionId, state.latestRequestedSequence);
    }
  }
}

export async function cancelSessionSolutionGeneration(sessionId: string) {
  const state = getOrCreateState(sessionId);

  clearScheduledTimer(state);
  state.latestRequestedSequence = 0;

  if (state.running) {
    state.discardRunningResult = true;
  }

  await persistIdleGenerationState(sessionId);
}

export async function scheduleSessionSolutionGeneration(
  sessionId: string,
  sourceEventSequence: number,
) {
  const state = getOrCreateState(sessionId);
  const now = Date.now();

  state.latestRequestedSequence = Math.max(
    state.latestRequestedSequence,
    sourceEventSequence,
  );

  if (state.running) {
    return;
  }

  if (state.firstScheduledAt === null) {
    state.firstScheduledAt = now;
  }

  const debounceUntilMs = Math.min(
    now + DEBOUNCE_MS,
    state.firstScheduledAt + MAX_WAIT_MS,
  );
  const debounceDelayMs = Math.max(0, debounceUntilMs - now);
  const debounceUntil = new Date(debounceUntilMs);
  const maxWaitUntil = new Date(state.firstScheduledAt + MAX_WAIT_MS);

  if (state.timer) {
    clearTimeout(state.timer);
  }

  await persistDebouncingGenerationState(
    sessionId,
    debounceUntil,
    maxWaitUntil,
    state.latestRequestedSequence,
  );

  state.timer = setTimeout(() => {
    clearScheduledTimer(state);
    void runGeneration(sessionId, state.latestRequestedSequence).catch((error) => {
      logger.error({ sessionId, err: error }, "Session solution generation failed");
    });
  }, debounceDelayMs);
}
