import { describe, expect, it } from "bun:test";

import { createExpiredSessionReconciler } from "@/server/session-reconciliation";

type SessionRecord = {
  id: string;
  status: "draft" | "live" | "ended" | "failed" | "expired";
  userId: string;
  title: string;
  type: "coding";
  language: "typescript" | null;
  createdAt: Date;
  startedAt: Date | null;
  expiresAt: Date | null;
  endedAt: Date | null;
  solutionEnabled: boolean;
};

function createSession(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    status: "live",
    userId: "user-1",
    title: "Session",
    type: "coding",
    language: "typescript",
    createdAt: new Date("2026-03-22T09:55:00.000Z"),
    startedAt: new Date("2026-03-22T10:00:00.000Z"),
    expiresAt: new Date("2026-03-22T11:00:00.000Z"),
    endedAt: null,
    solutionEnabled: true,
    ...partial,
  };
}

describe("expired session reconciliation", () => {
  it("expires each overdue live session returned by the selector", async () => {
    const now = new Date("2026-03-22T12:00:00.000Z");
    const sessions = [
      createSession({ id: "session-1" }),
      createSession({ id: "session-2", expiresAt: new Date("2026-03-22T11:30:00.000Z") }),
    ];
    const expired: string[] = [];

    const reconcileExpiredSessions = createExpiredSessionReconciler({
      listExpiredLiveSessions: async () => sessions,
      expireSession: async (session) => {
        expired.push(session.id);
        return { ...session, status: "expired" as const, endedAt: now };
      },
    });

    const count = await reconcileExpiredSessions(now);

    expect(count).toBe(2);
    expect(expired).toEqual(["session-1", "session-2"]);
  });

  it("does nothing when there are no overdue live sessions", async () => {
    let expireCalls = 0;

    const reconcileExpiredSessions = createExpiredSessionReconciler({
      listExpiredLiveSessions: async () => [],
      expireSession: async (session) => {
        expireCalls += 1;
        return session;
      },
    });

    const count = await reconcileExpiredSessions(new Date("2026-03-22T12:00:00.000Z"));

    expect(count).toBe(0);
    expect(expireCalls).toBe(0);
  });

  it("leaves draft sessions out of reconciliation input", async () => {
    const sessions = [
      createSession({ id: "draft-1", status: "draft", startedAt: null, expiresAt: null }),
    ];
    const seen: string[] = [];

    const reconcileExpiredSessions = createExpiredSessionReconciler({
      listExpiredLiveSessions: async () => sessions.filter((session) => session.status === "live"),
      expireSession: async (session) => {
        seen.push(session.id);
        return session;
      },
    });

    const count = await reconcileExpiredSessions(new Date("2026-03-22T12:00:00.000Z"));

    expect(count).toBe(0);
    expect(seen).toEqual([]);
  });
});
