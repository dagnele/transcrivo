import { describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";

import { assignDraftSessionAccess } from "@/server/session-start-access";

describe("assignDraftSessionAccess", () => {
  it("prefers consuming a paid credit before using the free trial", async () => {
    let paidCalls = 0;
    let trialCalls = 0;

    const result = await assignDraftSessionAccess({
      purchasedSessionCredits: 1,
      trialUsedAt: null,
      startedAt: new Date("2026-03-24T12:00:00.000Z"),
      consumePaidCredit: async () => {
        paidCalls += 1;
        return true;
      },
      consumeTrial: async () => {
        trialCalls += 1;
        return true;
      },
    });

    expect(result.accessKind).toBe("paid");
    expect(result.trialEndsAt).toBeNull();
    expect(paidCalls).toBe(1);
    expect(trialCalls).toBe(0);
  });

  it("falls back to the free trial when paid credit consumption loses a race", async () => {
    let paidCalls = 0;
    let trialCalls = 0;

    const result = await assignDraftSessionAccess({
      purchasedSessionCredits: 1,
      trialUsedAt: null,
      startedAt: new Date("2026-03-24T12:00:00.000Z"),
      consumePaidCredit: async () => {
        paidCalls += 1;
        return false;
      },
      consumeTrial: async () => {
        trialCalls += 1;
        return true;
      },
    });

    expect(result.accessKind).toBe("trial");
    expect(result.trialEndsAt?.toISOString()).toBe("2026-03-24T12:05:00.000Z");
    expect(paidCalls).toBe(1);
    expect(trialCalls).toBe(1);
  });

  it("rejects start when no paid credit or trial can be consumed", async () => {
    await expect(
      assignDraftSessionAccess({
        purchasedSessionCredits: 0,
        trialUsedAt: new Date("2026-03-24T10:00:00.000Z"),
        startedAt: new Date("2026-03-24T12:00:00.000Z"),
        consumePaidCredit: async () => false,
        consumeTrial: async () => false,
      }),
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "FORBIDDEN",
    });
  });

  it("handles concurrent draft starts with a single paid credit", async () => {
    let credits = 1;
    let trialUsedAt: Date | null = null;

    const createAttempt = () =>
      assignDraftSessionAccess({
        purchasedSessionCredits: credits,
        trialUsedAt,
        startedAt: new Date("2026-03-24T12:00:00.000Z"),
        consumePaidCredit: async () => {
          if (credits <= 0) return false;
          await Promise.resolve();
          if (credits <= 0) return false;
          credits -= 1;
          return true;
        },
        consumeTrial: async () => {
          if (trialUsedAt) return false;
          await Promise.resolve();
          if (trialUsedAt) return false;
          trialUsedAt = new Date("2026-03-24T12:00:00.000Z");
          return true;
        },
      });

    const results = await Promise.all([createAttempt(), createAttempt()]);
    const accessKinds = results.map((result) => result.accessKind).sort();

    expect(accessKinds).toEqual(["paid", "trial"]);
    expect(credits).toBe(0);
    expect(trialUsedAt?.toISOString()).toBe("2026-03-24T12:00:00.000Z");
  });

  it("reuses the existing assignment on repeated session.started handling", async () => {
    const first = await assignDraftSessionAccess({
      purchasedSessionCredits: 1,
      trialUsedAt: null,
      startedAt: new Date("2026-03-24T12:00:00.000Z"),
      consumePaidCredit: async () => true,
      consumeTrial: async () => false,
    });

    expect(first.accessKind).toBe("paid");

    const existingAssignment = { accessKind: "paid" as const, trialEndsAt: null };
    expect(existingAssignment).toEqual({ accessKind: "paid", trialEndsAt: null });
  });
});
