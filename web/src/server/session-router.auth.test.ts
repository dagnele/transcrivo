import { beforeEach, describe, expect, it, mock } from "bun:test";

type ConditionCapture = {
  findFirstWhere: unknown[];
  selectWhere: unknown[];
  updateWhere: unknown[];
  deleteWhere: unknown[];
};

const captures: ConditionCapture = {
  findFirstWhere: [],
  selectWhere: [],
  updateWhere: [],
  deleteWhere: [],
};

const dbMock = {
  query: {
    sessions: {
      findFirst: async ({ where }: { where?: unknown }) => {
        captures.findFirstWhere.push(where);
        return null;
      },
    },
    sessionEvents: {
      findFirst: async () => null,
    },
    sessionSolutions: {
      findFirst: async () => null,
    },
  },
  select: () => ({
    from: () => ({
      where: (condition: unknown) => {
        captures.selectWhere.push(condition);
        return {
          orderBy: () => ({
            limit: async () => [],
          }),
        };
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: (condition: unknown) => {
        captures.updateWhere.push(condition);
        return {
          returning: async () => [],
        };
      },
    }),
  }),
  delete: () => ({
    where: (condition: unknown) => {
      captures.deleteWhere.push(condition);
      return {
        returning: async () => [],
      };
    },
  }),
};

mock.module("@/server/db/client", () => ({
  db: dbMock,
}));

mock.module("@/server/token", () => ({
  CLI_TOKEN_LIFETIME_MS: 90 * 60 * 1000,
  signSessionToken: async () => "signed-token",
}));

const { sessionRouter } = await import("@/server/api/routers/session");

function createCaller(userId = "viewer-1") {
  return sessionRouter.createCaller({
    headers: new Headers(),
    session: {
      user: { id: userId },
    },
  } as never);
}

function renderCondition(condition: unknown) {
  return (condition as {
    toQuery: (config: {
      escapeName: (name: string) => string;
      escapeParam: (index: number) => string;
      escapeString: (value: string) => string;
      casing: { getColumnCasing: (column: { name: string }) => string };
      prepareTyping: () => undefined;
      paramStartIndex: { value: number };
      inlineParams: boolean;
      invokeSource?: undefined;
    }) => { sql: string; params: unknown[] };
  }).toQuery({
    escapeName: (name) => name,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
    casing: {
      getColumnCasing: (column) => column.name,
    },
    prepareTyping: () => undefined,
    paramStartIndex: { value: 0 },
    inlineParams: false,
    invokeSource: undefined,
  });
}

function expectConditionParams(condition: unknown, expectedParams: unknown[]) {
  const rendered = renderCondition(condition);
  expect(rendered.params).toEqual(expect.arrayContaining(expectedParams));
}

beforeEach(() => {
  captures.findFirstWhere = [];
  captures.selectWhere = [];
  captures.updateWhere = [];
  captures.deleteWhere = [];
});

describe("session router ownership enforcement", () => {
  it("scopes list to the current user", async () => {
    const caller = createCaller();

    const result = await caller.list({ limit: 1 });

    expect(result).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(captures.selectWhere).toHaveLength(1);
    expectConditionParams(captures.selectWhere[0], ["viewer-1"]);
  });

  it.each([
    {
      name: "byId",
      invoke: (caller: ReturnType<typeof createCaller>) => caller.byId({ sessionId: "session-2" }),
    },
    {
      name: "latestSequence",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.latestSequence({ sessionId: "session-2" }),
    },
    {
      name: "solution",
      invoke: (caller: ReturnType<typeof createCaller>) => caller.solution({ sessionId: "session-2" }),
    },
    {
      name: "solutionHistory",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.solutionHistory({ sessionId: "session-2" }),
    },
    {
      name: "transcriptPage",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.transcriptPage({ sessionId: "session-2", limit: 10 }),
    },
    {
      name: "createToken",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.createToken({ sessionId: "session-2" }),
    },
  ])("returns NOT_FOUND for $name when the session belongs to another user", async ({ invoke }) => {
    const caller = createCaller();

    await expect(invoke(caller)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(captures.findFirstWhere).toHaveLength(1);
    expectConditionParams(captures.findFirstWhere[0], ["session-2", "viewer-1"]);
  });

  it.each([
    {
      name: "update",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.update({
          sessionId: "session-2",
          title: "Updated title",
          type: "coding",
          language: "typescript",
        }),
    },
    {
      name: "toggleSolution",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        caller.toggleSolution({ sessionId: "session-2", enabled: true }),
    },
  ])("returns NOT_FOUND for $name when updating another user's session", async ({ invoke }) => {
    const caller = createCaller();

    await expect(invoke(caller)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(captures.updateWhere).toHaveLength(1);
    expectConditionParams(captures.updateWhere[0], ["session-2", "viewer-1"]);
  });

  it("returns NOT_FOUND when deleting another user's session", async () => {
    const caller = createCaller();

    await expect(caller.delete({ sessionId: "session-2" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(captures.deleteWhere).toHaveLength(1);
    expectConditionParams(captures.deleteWhere[0], ["session-2", "viewer-1"]);
  });
});

describe("session router subscription ownership enforcement", () => {
  it.each([
    {
      name: "subscribe",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        Promise.resolve(caller.subscribe({ sessionId: "session-2" })),
    },
    {
      name: "solutionSubscribe",
      invoke: (caller: ReturnType<typeof createCaller>) =>
        Promise.resolve(caller.solutionSubscribe({ sessionId: "session-2" })),
    },
  ])("rejects $name for another user's session before streaming", async ({ invoke }) => {
    const caller = createCaller();
    const subscription = (await invoke(caller))[Symbol.asyncIterator]();

    await expect(subscription.next()).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(captures.findFirstWhere).toHaveLength(1);
    expectConditionParams(captures.findFirstWhere[0], ["session-2", "viewer-1"]);
  });
});
