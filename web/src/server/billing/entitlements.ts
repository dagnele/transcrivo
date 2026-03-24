import { and, eq, isNull, sql } from "drizzle-orm";

import type { EntitlementSummary } from "@/lib/contracts/billing";
import { generateBillingProfileId } from "@/lib/ids";
import { db } from "@/server/db/client";
import { userBillingProfiles } from "@/server/db/schema";
import { createLogger } from "@/server/logger";

const log = createLogger("entitlements");

export async function getOrCreateBillingProfile(userId: string) {
  const existing = await db.query.userBillingProfiles.findFirst({
    where: eq(userBillingProfiles.userId, userId),
  });

  if (existing) return existing;

  const [profile] = await db
    .insert(userBillingProfiles)
    .values({
      id: generateBillingProfileId(),
      userId,
    })
    .onConflictDoNothing({ target: userBillingProfiles.userId })
    .returning();

  if (!profile) {
    return db.query.userBillingProfiles.findFirst({
      where: eq(userBillingProfiles.userId, userId),
    });
  }

  return profile;
}

export async function getUserEntitlementSummary(
  userId: string,
): Promise<EntitlementSummary> {
  const profile = await getOrCreateBillingProfile(userId);

  return {
    availablePurchasedSessions: profile?.purchasedSessionCredits ?? 0,
    trialAvailable: profile?.trialUsedAt == null,
  };
}

export async function grantPurchasedSessions(
  userId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;

  await getOrCreateBillingProfile(userId);

  await db
    .update(userBillingProfiles)
    .set({
      purchasedSessionCredits: sql`${userBillingProfiles.purchasedSessionCredits} + ${count}`,
      updatedAt: new Date(),
    })
    .where(eq(userBillingProfiles.userId, userId));

  log.info({ userId, count }, "Purchased session credits granted");
}

export async function markTrialUsed(userId: string): Promise<boolean> {
  await getOrCreateBillingProfile(userId);

  const [updated] = await db
    .update(userBillingProfiles)
    .set({
      trialUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userBillingProfiles.userId, userId),
        isNull(userBillingProfiles.trialUsedAt),
      ),
    )
    .returning({ userId: userBillingProfiles.userId });

  return Boolean(updated);
}
