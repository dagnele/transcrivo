import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { SessionEvent } from "@/lib/contracts/event";
import type { Session } from "@/server/db/schema";

const publishedEvents: Array<{ sessionId: string; sequence: number; type: string }> = [];
const transactionSessions: Session[] = [];
const latestEventResults: Array<{ sequence: number } | null> = [];
const existingStartedEventResults: Array<Record<string, unknown> | null> = [];
const insertedSessionEvents: Array<Record<string, unknown>> = [];

const txMock = {
  execute: async () => undefined,
  query: {
    sessions: {
      findFirst: async () => transactionSessions.shift() ?? null,
    },
    sessionEvents: {
      findFirst: async () => {
        if (existingStartedEventResults.length > 0) {
          return existingStartedEventResults.shift() ?? null;
        }
        return latestEventResults.shift() ?? null;
      },
    },
    userBillingProfiles: {
      findFirst: async () => null,
    },
  },
  insert: () => ({
    values: (value: Record<string, unknown>) => ({
      onConflictDoNothing: async () => value,
      returning: async () => {
        insertedSessionEvents.push(value);
        return [value];
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: async () => [],
    }),
  }),
};

const dbMock = {
  transaction: async <T>(callback: (tx: typeof txMock) => Promise<T>) => callback(txMock),
  query: {
    sessions: {
      findFirst: async () => null,
    },
    sessionEvents: {
      findFirst: async () => null,
    },
  },
  insert: () => ({
    values: () => ({
      returning: async () => [],
    }),
  }),
  update: () => ({
    set: () => ({
      where: async () => [],
    }),
  }),
};

mock.module("@/server/db/client", () => ({
  db: dbMock,
}));

mock.module("@/server/api/session-events", () => ({
  getLastPublishedSessionSequence: () => 0,
  publishSessionEvent: (event: { sessionId: string; sequence: number; type: string }) => {
    publishedEvents.push(event);
  },
}));

mock.module("@/server/ai/session-solution-worker", () => ({
  scheduleSessionSolutionGeneration: async () => undefined,
}));

const { ingestSessionEvent } = await import("@/server/api/session-event-ingest");

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    userId: "user-1",
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
    accessKind: "paid",
    trialEndsAt: null,
    createdAt: new Date("2026-04-08T10:00:00.000Z"),
    startedAt: new Date("2026-04-08T10:05:00.000Z"),
    endedAt: null,
    expiresAt: new Date("2026-04-08T11:05:00.000Z"),
    ...overrides,
  };
}

describe("ingestSessionEvent", () => {
  beforeEach(() => {
    publishedEvents.length = 0;
    transactionSessions.length = 0;
    latestEventResults.length = 0;
    existingStartedEventResults.length = 0;
    insertedSessionEvents.length = 0;
  });

  it("does not republish an existing session.started event", async () => {
    const existingStartedEvent: SessionEvent = {
      id: "evt-1",
      sessionId: "session-1",
      sequence: 3,
      type: "session.started",
      createdAt: new Date("2026-04-08T10:05:00.000Z"),
      payload: {
        reason: "cli-session-start",
        accessKind: "paid",
        startedAt: "2026-04-08T10:05:00.000Z",
        expiresAt: "2026-04-08T11:05:00.000Z",
        trialEndsAt: null,
      },
    };

    transactionSessions.push(createSession());
    existingStartedEventResults.push(existingStartedEvent);

    const result = await ingestSessionEvent({
      sessionId: "session-1",
      type: "session.started",
      payload: { reason: "cli-session-start" },
    });

    expect(result).toEqual(existingStartedEvent);
    expect(publishedEvents).toEqual([]);
    expect(insertedSessionEvents).toEqual([]);
  });
});
