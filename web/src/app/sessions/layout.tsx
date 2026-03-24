import type { Metadata } from "next";

import type { EntitlementSummary } from "@/lib/contracts/billing";
import { SessionsShell } from "@/components/sessions/sessions-shell";
import { getRequiredSession } from "@/server/auth-session";
import { getServerTRPCCaller } from "@/server/api/caller";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sessions",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SessionsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await getRequiredSession();

  let sessions: Awaited<
    ReturnType<(Awaited<ReturnType<typeof getServerTRPCCaller>>)["session"]["list"]>
  > | null = null;
  let sessionsError: string | null = null;
  let entitlements: EntitlementSummary | null = null;

  try {
    const caller = await getServerTRPCCaller();
    const [sessionsResult, entitlementsResult] = await Promise.all([
      caller.session.list({ limit: 50 }),
      caller.billing.entitlements().catch(() => null),
    ]);
    sessions = sessionsResult;
    entitlements = entitlementsResult;
  } catch (error) {
    sessionsError =
      error instanceof Error
        ? error.message
        : "Unable to load sessions right now.";
  }

  return (
    <SessionsShell
      sessions={sessions?.items ?? []}
      sessionsError={sessionsError}
      entitlements={entitlements}
    >
      {children}
    </SessionsShell>
  );
}
