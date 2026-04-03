import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { Session } from "@/lib/contracts/session";

const scheduledCalls: Array<{ sessionId: string; sequence: number }> = [];
const cancelledCalls: string[] = [];
const sessionUpdateResults: Session[] = [];
const sessionFindFirstResults: unknown[] = [];
const latestFinalEventResults: Array<{ sequence: number } | null> = [];

const dbMock = {
  query: {
    sessions: {
      findFirst: async () => sessionFindFirstResults.shift() ?? null,
    },
    sessionEvents: {
      findFirst: async () => latestFinalEventResults.shift() ?? null,
    },
    sessionSolutions: {
      findFirst: async () => null,
    },
  },
  update: () => ({
    set: () => ({
      where: () => ({
        returning: async () => {
          const next = sessionUpdateResults.shift();
          return next ? [next] : [];
        },
      }),
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }),
  delete: () => ({
    where: () => ({
      returning: async () => [],
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: async () => [],
    }),
  }),
};

mock.module("@/server/db/client", () => ({
  db: dbMock,
}));

mock.module("@/server/ai/session-solution-worker", () => ({
  scheduleSessionSolutionGeneration: async (sessionId: string, sequence: number) => {
    scheduledCalls.push({ sessionId, sequence });
  },
  cancelSessionSolutionGeneration: async (sessionId: string) => {
    cancelledCalls.push(sessionId);
  },
}));

mock.module("@/server/token", () => ({
  CLI_TOKEN_LIFETIME_MS: 90 * 60 * 1000,
  signSessionToken: async () => "signed-token",
}));

const { sessionRouter } = await import("@/server/api/routers/session");

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Session",
    type: "coding",
    language: "typescript",
    status: "live",
    solutionEnabled: true,
    solutionGenerationStatus: "idle",
    solutionGenerationStartedAt: null,
    solutionGenerationDebounceUntil: null,
    solutionGenerationMaxWaitUntil: null,
    solutionGenerationSourceEventSequence: null,
    accessKind: null,
    trialEndsAt: null,
    createdAt: new Date("2026-04-03T10:00:00.000Z"),
    startedAt: new Date("2026-04-03T10:00:00.000Z"),
    endedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function createCaller(userId = "viewer-1") {
  return sessionRouter.createCaller({
    headers: new Headers(),
    session: {
      user: { id: userId },
    },
  } as never);
}

beforeEach(() => {
  scheduledCalls.length = 0;
  cancelledCalls.length = 0;
  sessionUpdateResults.length = 0;
  sessionFindFirstResults.length = 0;
  latestFinalEventResults.length = 0;
});

describe("session router toggleSolution", () => {
  it("schedules generation when enabling and finalized transcript already exists", async () => {
    sessionUpdateResults.push(createSession({ solutionEnabled: true }));
    latestFinalEventResults.push({ sequence: 7 });
    sessionFindFirstResults.push(
      createSession({
        solutionEnabled: true,
        solutionGenerationStatus: "debouncing",
        solutionGenerationSourceEventSequence: 7,
      }),
    );

    const caller = createCaller();
    const result = await caller.toggleSolution({ sessionId: "session-1", enabled: true });

    expect(scheduledCalls).toEqual([{ sessionId: "session-1", sequence: 7 }]);
    expect(cancelledCalls).toEqual([]);
    expect(result.solutionGenerationStatus).toBe("debouncing");
    expect(result.solutionGenerationSourceEventSequence).toBe(7);
  });

  it("does not schedule generation when enabling with no finalized transcript", async () => {
    sessionUpdateResults.push(createSession({ solutionEnabled: true }));
    latestFinalEventResults.push(null);
    sessionFindFirstResults.push(createSession({ solutionEnabled: true }));

    const caller = createCaller();
    const result = await caller.toggleSolution({ sessionId: "session-1", enabled: true });

    expect(scheduledCalls).toEqual([]);
    expect(cancelledCalls).toEqual([]);
    expect(result.solutionGenerationStatus).toBe("idle");
    expect(result.solutionGenerationSourceEventSequence).toBeNull();
  });

  it("cancels generation and returns refreshed idle fields when disabling", async () => {
    sessionUpdateResults.push(createSession({ solutionEnabled: false }));
    sessionFindFirstResults.push(
      createSession({
        solutionEnabled: false,
        solutionGenerationStatus: "idle",
        solutionGenerationStartedAt: null,
        solutionGenerationDebounceUntil: null,
        solutionGenerationMaxWaitUntil: null,
        solutionGenerationSourceEventSequence: null,
      }),
    );

    const caller = createCaller();
    const result = await caller.toggleSolution({ sessionId: "session-1", enabled: false });

    expect(cancelledCalls).toEqual(["session-1"]);
    expect(scheduledCalls).toEqual([]);
    expect(result.solutionGenerationStatus).toBe("idle");
    expect(result.solutionGenerationStartedAt).toBeNull();
    expect(result.solutionGenerationDebounceUntil).toBeNull();
    expect(result.solutionGenerationMaxWaitUntil).toBeNull();
    expect(result.solutionGenerationSourceEventSequence).toBeNull();
  });
});
