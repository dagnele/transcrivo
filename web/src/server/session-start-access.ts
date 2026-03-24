import { TRPCError } from "@trpc/server";

import type { SessionAccessKind } from "@/lib/contracts/billing";

const TRIAL_DURATION_MS = 5 * 60 * 1000;

type AssignDraftSessionAccessInput = {
  purchasedSessionCredits: number;
  trialUsedAt: Date | null;
  startedAt: Date;
  consumePaidCredit: () => Promise<boolean>;
  consumeTrial: () => Promise<boolean>;
};

type AssignDraftSessionAccessResult = {
  accessKind: SessionAccessKind;
  trialEndsAt: Date | null;
};

export async function assignDraftSessionAccess(
  input: AssignDraftSessionAccessInput,
): Promise<AssignDraftSessionAccessResult> {
  if (input.purchasedSessionCredits > 0) {
    const paidConsumed = await input.consumePaidCredit();

    if (paidConsumed) {
      return {
        accessKind: "paid",
        trialEndsAt: null,
      };
    }
  }

  if (input.trialUsedAt == null) {
    const trialConsumed = await input.consumeTrial();

    if (trialConsumed) {
      return {
        accessKind: "trial",
        trialEndsAt: new Date(input.startedAt.getTime() + TRIAL_DURATION_MS),
      };
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "No session credits available. Please purchase a session to continue.",
  });
}
