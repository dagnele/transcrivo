import { SessionsShell } from "@/components/sessions/sessions-shell";
import { getRequiredSession } from "@/server/auth-session";
import { getServerTRPCCaller } from "@/server/api/caller";

export const dynamic = "force-dynamic";

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

  try {
    const caller = await getServerTRPCCaller();
    sessions = await caller.session.list({ limit: 50 });
  } catch (error) {
    sessionsError =
      error instanceof Error
        ? error.message
        : "Unable to load sessions right now.";
  }

  return (
    <SessionsShell sessions={sessions?.items ?? []} sessionsError={sessionsError}>
      {children}
    </SessionsShell>
  );
}
