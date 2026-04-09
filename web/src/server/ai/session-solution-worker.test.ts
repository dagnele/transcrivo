import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import type {
  CodingSolutionStructured,
  SessionSolutionEvent,
  SessionSolutionMetadata,
} from "@/lib/contracts/solution";

function createStructuredCodingMeta(
  overrides: Partial<CodingSolutionStructured> = {},
): SessionSolutionMetadata {
  return {
    structured: {
      type: "coding",
      data: {
        understanding: "Generated understanding.",
        approach: "Generated approach.",
        solution: "Generated solution.",
        notes: "Generated notes.",
        ...overrides,
      },
    },
  };
}

type SessionRecord = {
  id: string;
  userId: string;
  title: string;
  type: "coding";
  language: "typescript";
  status: "live";
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  expiresAt: Date | null;
  solutionEnabled: boolean;
  solutionGenerationStatus: "idle" | "debouncing" | "generating";
  solutionGenerationStartedAt: Date | null;
  solutionGenerationDebounceUntil: Date | null;
  solutionGenerationMaxWaitUntil: Date | null;
  solutionGenerationSourceEventSequence: number | null;
  accessKind: null;
  trialEndsAt: null;
};

type SessionSolutionRecord = {
  id: string;
  sessionId: string;
  status: "ready" | "error";
  format: "markdown";
  content: string;
  version: number;
  sourceEventSequence: number;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  meta: SessionSolutionMetadata;
  createdAt: Date;
  updatedAt: Date;
};

type TranscriptEventRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  type: "transcript.final";
  createdAt: Date;
  payload: {
    eventId?: string;
    utteranceId?: string;
    source: "mic";
    text: string;
    startMs: number;
    endMs: number;
  };
};

type GenerateInput = {
  session: SessionRecord;
  transcriptEvents: TranscriptEventRecord[];
  previousSolutionContent?: string | null;
};

type FakeTimer = {
  id: number;
  runAt: number;
  callback: () => void;
};

const sessionFindFirstQueue: Array<SessionRecord | { solutionEnabled: boolean } | null> = [];
const sessionSolutionsFindFirstQueue: Array<SessionSolutionRecord | null> = [];
const transcriptSelectQueue: TranscriptEventRecord[][] = [];
const sessionUpdates: Array<Record<string, unknown>> = [];
const insertedSolutions: SessionSolutionRecord[] = [];
const publishedSolutionEvents: SessionSolutionEvent[] = [];
const generatedInputs: GenerateInput[] = [];

let nextGeneratedSolutionId = 1;
let generateImpl: (input: GenerateInput) => Promise<{
  content: string;
  format: "markdown";
  provider: string;
  model: string;
  promptVersion: string;
  meta: SessionSolutionMetadata;
}>;

const dbMock = {
  query: {
    sessions: {
      findFirst: async () => sessionFindFirstQueue.shift() ?? null,
    },
    sessionSolutions: {
      findFirst: async () => sessionSolutionsFindFirstQueue.shift() ?? null,
    },
  },
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: async () => transcriptSelectQueue.shift() ?? [],
      }),
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        sessionUpdates.push(values);
        return [];
      },
    }),
  }),
  insert: () => ({
    values: (values: Omit<SessionSolutionRecord, "createdAt" | "updatedAt">) => ({
      returning: async () => {
        const row: SessionSolutionRecord = {
          ...values,
          createdAt: new Date(Date.now()),
          updatedAt: new Date(Date.now()),
        };
        insertedSolutions.push(row);
        return [row];
      },
    }),
  }),
};

mock.module("@/server/db/client", () => ({
  db: dbMock,
}));

mock.module("@/server/api/session-events", () => ({
  publishSessionSolutionEvent: (event: SessionSolutionEvent) => {
    publishedSolutionEvents.push(event);
  },
}));

mock.module("@/server/ai/session-solution-service", () => ({
  generateSessionSolution: async (input: GenerateInput) => {
    generatedInputs.push(input);
    return generateImpl(input);
  },
}));

mock.module("@/server/logger", () => ({
  createLogger: () => ({
    error: () => undefined,
  }),
}));

mock.module("@/lib/ids", () => ({
  generateSessionSolutionId: () => `solution-${nextGeneratedSolutionId++}`,
}));

const workerModule = await import("@/server/ai/session-solution-worker");

const { cancelSessionSolutionGeneration, scheduleSessionSolutionGeneration } = workerModule;

function clearWorkerState() {
  const globalWorker = globalThis as typeof globalThis & {
    __transcrivoSessionSolutionWorker__?: Map<string, unknown>;
  };

  globalWorker.__transcrivoSessionSolutionWorker__?.clear();
}

let nowMs = 0;
let nextTimerId = 1;
let fakeTimers: FakeTimer[] = [];
let originalSetTimeout: typeof globalThis.setTimeout;
let originalClearTimeout: typeof globalThis.clearTimeout;
let originalDateNow: typeof Date.now;

function createSessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    title: "TypeScript session",
    type: "coding",
    language: "typescript",
    status: "live",
    createdAt: new Date("2026-04-03T10:00:00.000Z"),
    startedAt: new Date("2026-04-03T10:00:00.000Z"),
    endedAt: null,
    expiresAt: null,
    solutionEnabled: true,
    solutionGenerationStatus: "idle",
    solutionGenerationStartedAt: null,
    solutionGenerationDebounceUntil: null,
    solutionGenerationMaxWaitUntil: null,
    solutionGenerationSourceEventSequence: null,
    accessKind: null,
    trialEndsAt: null,
    ...overrides,
  };
}

function createReadySolution(overrides: Partial<SessionSolutionRecord> = {}): SessionSolutionRecord {
  return {
    id: "ready-1",
    sessionId: "session-1",
    status: "ready",
    format: "markdown",
    content: "## Understanding\nExisting\n\n## Approach\nExisting\n\n## Solution\nExisting\n\n## Notes\nExisting",
    version: 1,
    sourceEventSequence: 3,
    errorMessage: null,
    provider: "openrouter",
    model: "model-a",
    promptVersion: "v4",
    meta: createStructuredCodingMeta({
      understanding: "Existing",
      approach: "Existing",
      solution: "Existing",
      notes: "Existing",
    }),
    createdAt: new Date("2026-04-03T10:00:00.000Z"),
    updatedAt: new Date("2026-04-03T10:00:00.000Z"),
    ...overrides,
  };
}

function createTranscriptEvent(sequence: number, text = `chunk-${sequence}`): TranscriptEventRecord {
  return {
    id: `event-${sequence}`,
    sessionId: "session-1",
    sequence,
    type: "transcript.final",
    createdAt: new Date("2026-04-03T10:00:00.000Z"),
    payload: {
      eventId: `evt-${sequence}`,
      utteranceId: `utt-${sequence}`,
      source: "mic",
      text,
      startMs: sequence * 1000,
      endMs: sequence * 1000 + 500,
    },
  };
}

function installFakeClock(startMs = 0) {
  nowMs = startMs;
  nextTimerId = 1;
  fakeTimers = [];

  originalSetTimeout = globalThis.setTimeout;
  originalClearTimeout = globalThis.clearTimeout;
  originalDateNow = Date.now;

  globalThis.setTimeout = (((callback: TimerHandler, delay?: number) => {
    const id = nextTimerId++;
    fakeTimers.push({
      id,
      runAt: nowMs + (delay ?? 0),
      callback: callback as () => void,
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown) as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((timerId: ReturnType<typeof setTimeout>) => {
    fakeTimers = fakeTimers.filter((timer) => timer.id !== (timerId as unknown as number));
  }) as typeof globalThis.clearTimeout;

  Date.now = () => nowMs;
}

function uninstallFakeClock() {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  Date.now = originalDateNow;
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

async function advanceBy(ms: number) {
  nowMs += ms;

  while (true) {
    fakeTimers.sort((left, right) => left.runAt - right.runAt);
    const nextTimer = fakeTimers[0];

    if (!nextTimer || nextTimer.runAt > nowMs) {
      break;
    }

    fakeTimers.shift();
    nextTimer.callback();
    await flushAsyncWork();
  }

  await flushAsyncWork();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  sessionFindFirstQueue.length = 0;
  sessionSolutionsFindFirstQueue.length = 0;
  transcriptSelectQueue.length = 0;
  sessionUpdates.length = 0;
  insertedSolutions.length = 0;
  publishedSolutionEvents.length = 0;
  generatedInputs.length = 0;
  nextGeneratedSolutionId = 1;
  generateImpl = async () => ({
    content: "## Understanding\nNew\n\n## Approach\nNew\n\n## Solution\nNew\n\n## Notes\nNew",
    format: "markdown",
    provider: "openrouter",
    model: "model-a",
    promptVersion: "v4",
    meta: createStructuredCodingMeta({
      understanding: "New",
      approach: "New",
      solution: "New",
      notes: "New",
    }),
  });

  clearWorkerState();
  installFakeClock(1_000);
});

afterEach(() => {
  uninstallFakeClock();
  clearWorkerState();
});

describe("session solution worker scheduling", () => {
  it("forces generation by max wait during continuous transcript input", async () => {
    sessionFindFirstQueue.push(createSessionRecord(), { solutionEnabled: true });
    sessionSolutionsFindFirstQueue.push(null, null);
    transcriptSelectQueue.push([createTranscriptEvent(3)]);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(4_000);

    await scheduleSessionSolutionGeneration("session-1", 2);
    await advanceBy(4_000);

    await scheduleSessionSolutionGeneration("session-1", 3);
    await advanceBy(1_999);

    expect(generatedInputs).toHaveLength(0);

    await advanceBy(1);

    expect(generatedInputs).toHaveLength(1);
    expect(generatedInputs[0]?.transcriptEvents.map((event) => event.sequence)).toEqual([3]);
    expect(sessionUpdates[0]).toMatchObject({
      solutionGenerationStatus: "debouncing",
      solutionGenerationSourceEventSequence: 1,
    });
    expect(sessionUpdates[1]).toMatchObject({
      solutionGenerationStatus: "debouncing",
      solutionGenerationSourceEventSequence: 2,
    });
    expect(sessionUpdates[2]).toMatchObject({
      solutionGenerationStatus: "debouncing",
      solutionGenerationSourceEventSequence: 3,
    });
    expect(sessionUpdates[3]).toMatchObject({
      solutionGenerationStatus: "generating",
      solutionGenerationSourceEventSequence: 3,
    });
    expect(sessionUpdates.at(-1)).toMatchObject({
      solutionGenerationStatus: "idle",
    });
  });

  it("cancels a pending debounce run when AI is disabled", async () => {
    await scheduleSessionSolutionGeneration("session-1", 1);
    await cancelSessionSolutionGeneration("session-1");
    await advanceBy(10_000);

    expect(generatedInputs).toHaveLength(0);
    expect(insertedSolutions).toHaveLength(0);
    expect(sessionUpdates[0]).toMatchObject({
      solutionGenerationStatus: "debouncing",
    });
    expect(sessionUpdates[1]).toMatchObject({
      solutionGenerationStatus: "idle",
    });
  });
});

describe("session solution worker generation", () => {
  it("reschedules a follow-up run when newer transcript arrives during generation", async () => {
    const deferred = createDeferred<{
      content: string;
      format: "markdown";
      provider: string;
      model: string;
      promptVersion: string;
      meta: SessionSolutionMetadata;
    }>();
    let callCount = 0;

    generateImpl = async () => {
      callCount += 1;

      if (callCount === 1) {
        return deferred.promise;
      }

      return {
        content: "## Understanding\nFollow-up\n\n## Approach\nFollow-up\n\n## Solution\nFollow-up\n\n## Notes\nFollow-up",
        format: "markdown",
        provider: "openrouter",
        model: "model-a",
        promptVersion: "v4",
        meta: createStructuredCodingMeta({
          understanding: "Follow-up",
          approach: "Follow-up",
          solution: "Follow-up",
          notes: "Follow-up",
        }),
      };
    };

    sessionFindFirstQueue.push(
      createSessionRecord(),
      { solutionEnabled: true },
      createSessionRecord(),
      { solutionEnabled: true },
    );
    sessionSolutionsFindFirstQueue.push(
      null,
      null,
      createReadySolution({ version: 1, sourceEventSequence: 1 }),
      createReadySolution({ version: 1, sourceEventSequence: 1 }),
    );
    transcriptSelectQueue.push(
      [createTranscriptEvent(1)],
      [createTranscriptEvent(2), createTranscriptEvent(3)],
    );

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(1);

    await scheduleSessionSolutionGeneration("session-1", 3);
    deferred.resolve({
      content: "## Understanding\nInitial\n\n## Approach\nInitial\n\n## Solution\nInitial\n\n## Notes\nInitial",
      format: "markdown",
      provider: "openrouter",
      model: "model-a",
      promptVersion: "v4",
      meta: createStructuredCodingMeta({
        understanding: "Initial",
        approach: "Initial",
        solution: "Initial",
        notes: "Initial",
      }),
    });
    await flushAsyncWork();

    expect(generatedInputs).toHaveLength(1);

    await advanceBy(4_999);
    expect(generatedInputs).toHaveLength(1);

    await advanceBy(1);

    expect(generatedInputs).toHaveLength(2);
    expect(generatedInputs[1]?.transcriptEvents.map((event) => event.sequence)).toEqual([
      2,
      3,
    ]);
    expect(generatedInputs[1]?.previousSolutionContent).toContain("## Understanding");
  });

  it("aborts cleanly when the session no longer exists when the timer fires", async () => {
    sessionFindFirstQueue.push(null);
    sessionSolutionsFindFirstQueue.push(null, null);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(0);
    expect(insertedSolutions).toHaveLength(0);
    expect(publishedSolutionEvents).toHaveLength(0);
    expect(sessionUpdates.at(-1)).toMatchObject({
      solutionGenerationStatus: "idle",
    });
  });

  it("aborts before the model call when AI is already disabled", async () => {
    sessionFindFirstQueue.push(createSessionRecord({ solutionEnabled: false }));
    sessionSolutionsFindFirstQueue.push(null, null);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(0);
    expect(insertedSolutions).toHaveLength(0);
    expect(publishedSolutionEvents).toHaveLength(0);
    expect(sessionUpdates[1]).toMatchObject({
      solutionGenerationStatus: "generating",
      solutionGenerationSourceEventSequence: 1,
    });
    expect(sessionUpdates.at(-1)).toMatchObject({
      solutionGenerationStatus: "idle",
    });
  });

  it("discards an in-flight result after AI is disabled", async () => {
    const deferred = createDeferred<{
      content: string;
      format: "markdown";
      provider: string;
      model: string;
      promptVersion: string;
      meta: SessionSolutionMetadata;
    }>();

    generateImpl = () => deferred.promise;

    sessionFindFirstQueue.push(createSessionRecord(), { solutionEnabled: true });
    sessionSolutionsFindFirstQueue.push(null, null);
    transcriptSelectQueue.push([createTranscriptEvent(1)]);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(1);

    await cancelSessionSolutionGeneration("session-1");
    deferred.resolve({
      content: "## Understanding\nNew\n\n## Approach\nNew\n\n## Solution\nNew\n\n## Notes\nNew",
      format: "markdown",
      provider: "openrouter",
      model: "model-a",
      promptVersion: "v4",
      meta: createStructuredCodingMeta({
        understanding: "New",
        approach: "New",
        solution: "New",
        notes: "New",
      }),
    });
    await flushAsyncWork();

    expect(insertedSolutions).toHaveLength(0);
    expect(publishedSolutionEvents.map((event) => event.type)).toEqual(["solution.generating"]);
    expect(sessionUpdates.some((update) => update.solutionGenerationStatus === "idle")).toBe(
      true,
    );
  });

  it("does not schedule a follow-up run after a discard caused by disabling AI", async () => {
    const deferred = createDeferred<{
      content: string;
      format: "markdown";
      provider: string;
      model: string;
      promptVersion: string;
      meta: SessionSolutionMetadata;
    }>();

    generateImpl = () => deferred.promise;

    sessionFindFirstQueue.push(createSessionRecord(), { solutionEnabled: true });
    sessionSolutionsFindFirstQueue.push(null, null);
    transcriptSelectQueue.push([createTranscriptEvent(1)]);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    await scheduleSessionSolutionGeneration("session-1", 3);
    await cancelSessionSolutionGeneration("session-1");

    deferred.resolve({
      content: "## Understanding\nNew\n\n## Approach\nNew\n\n## Solution\nNew\n\n## Notes\nNew",
      format: "markdown",
      provider: "openrouter",
      model: "model-a",
      promptVersion: "v4",
      meta: createStructuredCodingMeta({
        understanding: "New",
        approach: "New",
        solution: "New",
        notes: "New",
      }),
    });
    await flushAsyncWork();
    await advanceBy(10_000);

    expect(generatedInputs).toHaveLength(1);
    expect(insertedSolutions).toHaveLength(0);
    expect(fakeTimers).toHaveLength(0);
  });

  it("uses only transcript events after the latest ready sequence for incremental runs", async () => {
    const latestReady = createReadySolution({
      version: 2,
      sourceEventSequence: 3,
      content: "prior ready content",
    });

    sessionFindFirstQueue.push(createSessionRecord(), { solutionEnabled: true });
    sessionSolutionsFindFirstQueue.push(latestReady, latestReady);
    transcriptSelectQueue.push([createTranscriptEvent(4), createTranscriptEvent(5)]);

    await scheduleSessionSolutionGeneration("session-1", 5);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(1);
    expect(generatedInputs[0]?.transcriptEvents.map((event) => event.sequence)).toEqual([4, 5]);
    expect(generatedInputs[0]?.previousSolutionContent).toBe("prior ready content");
    expect(insertedSolutions[0]).toMatchObject({
      version: 3,
      sourceEventSequence: 5,
    });
  });

  it("falls back to empty content when an error row is created without a ready solution", async () => {
    generateImpl = async () => {
      throw Object.assign(new Error("provider failed"), {
        provider: "openrouter",
        model: "model-c",
        promptVersion: "v4",
      });
    };

    sessionFindFirstQueue.push(createSessionRecord());
    sessionSolutionsFindFirstQueue.push(null, null);
    transcriptSelectQueue.push([createTranscriptEvent(1)]);

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    expect(insertedSolutions).toHaveLength(1);
    expect(insertedSolutions[0]).toMatchObject({
      status: "error",
      content: "",
      provider: "openrouter",
      model: "model-c",
      promptVersion: "v4",
      meta: null,
    });
  });

  it("coalesces multiple schedule requests while running into a single follow-up cycle", async () => {
    const deferred = createDeferred<{
      content: string;
      format: "markdown";
      provider: string;
      model: string;
      promptVersion: string;
      meta: SessionSolutionMetadata;
    }>();
    let callCount = 0;

    generateImpl = async () => {
      callCount += 1;

      if (callCount === 1) {
        return deferred.promise;
      }

      return {
        content: "## Understanding\nFinal\n\n## Approach\nFinal\n\n## Solution\nFinal\n\n## Notes\nFinal",
        format: "markdown",
        provider: "openrouter",
        model: "model-a",
        promptVersion: "v4",
        meta: createStructuredCodingMeta({
          understanding: "Final",
          approach: "Final",
          solution: "Final",
          notes: "Final",
        }),
      };
    };

    sessionFindFirstQueue.push(
      createSessionRecord(),
      { solutionEnabled: true },
      createSessionRecord(),
      { solutionEnabled: true },
    );
    sessionSolutionsFindFirstQueue.push(
      null,
      null,
      createReadySolution({ version: 1, sourceEventSequence: 1 }),
      createReadySolution({ version: 1, sourceEventSequence: 1 }),
    );
    transcriptSelectQueue.push(
      [createTranscriptEvent(1)],
      [createTranscriptEvent(4)],
    );

    await scheduleSessionSolutionGeneration("session-1", 1);
    await advanceBy(5_000);

    await scheduleSessionSolutionGeneration("session-1", 2);
    await scheduleSessionSolutionGeneration("session-1", 3);
    await scheduleSessionSolutionGeneration("session-1", 4);

    deferred.resolve({
      content: "## Understanding\nInitial\n\n## Approach\nInitial\n\n## Solution\nInitial\n\n## Notes\nInitial",
      format: "markdown",
      provider: "openrouter",
      model: "model-a",
      promptVersion: "v4",
      meta: createStructuredCodingMeta({
        understanding: "Initial",
        approach: "Initial",
        solution: "Initial",
        notes: "Initial",
      }),
    });
    await flushAsyncWork();
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(2);
    expect(generatedInputs[1]?.transcriptEvents.map((event) => event.sequence)).toEqual([4]);
    expect(fakeTimers).toHaveLength(0);
  });

  it("skips no-op incremental runs that are already covered by the latest ready solution", async () => {
    sessionFindFirstQueue.push(createSessionRecord());
    sessionSolutionsFindFirstQueue.push(
      createReadySolution({ version: 4, sourceEventSequence: 10 }),
      createReadySolution({ version: 4, sourceEventSequence: 10 }),
    );

    await scheduleSessionSolutionGeneration("session-1", 9);
    await advanceBy(5_000);

    expect(generatedInputs).toHaveLength(0);
    expect(insertedSolutions).toHaveLength(0);
    expect(publishedSolutionEvents).toHaveLength(0);
    expect(sessionUpdates[1]).toMatchObject({
      solutionGenerationStatus: "generating",
      solutionGenerationSourceEventSequence: 9,
    });
    expect(sessionUpdates.at(-1)).toMatchObject({
      solutionGenerationStatus: "idle",
    });
  });

  it("persists attempted-run metadata on error rows", async () => {
    generateImpl = async () => {
      throw Object.assign(new Error("provider failed"), {
        provider: "openrouter",
        model: "model-b",
        promptVersion: "v4",
      });
    };

    const latestReady = createReadySolution({
      version: 2,
      sourceEventSequence: 3,
      content: "last ready content",
      provider: "openrouter",
      model: "old-model",
      promptVersion: "v2",
      meta: createStructuredCodingMeta({
        understanding: "Stale",
        approach: "Stale",
        solution: "Stale",
        notes: "Stale",
      }),
    });

    sessionFindFirstQueue.push(createSessionRecord());
    sessionSolutionsFindFirstQueue.push(latestReady, latestReady);
    transcriptSelectQueue.push([createTranscriptEvent(4)]);

    await scheduleSessionSolutionGeneration("session-1", 4);
    await advanceBy(5_000);

    expect(insertedSolutions).toHaveLength(1);
    expect(insertedSolutions[0]).toMatchObject({
      status: "error",
      content: "last ready content",
      provider: "openrouter",
      model: "model-b",
      promptVersion: "v4",
      meta: null,
      version: 3,
      sourceEventSequence: 4,
    });
    expect(publishedSolutionEvents.map((event) => event.type)).toEqual([
      "solution.generating",
      "solution.failed",
    ]);
  });
});
