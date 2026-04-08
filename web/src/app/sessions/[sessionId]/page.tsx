import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SessionLiveView } from "@/components/sessions/session-live-view";
import { getServerTRPCCaller } from "@/server/api/caller";
import { getRequiredSession } from "@/server/auth-session";

type SessionDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  await getRequiredSession();

  const { sessionId } = await params;

  let session: Awaited<
    ReturnType<(Awaited<ReturnType<typeof getServerTRPCCaller>>)["session"]["byId"]>
  >;
  let latestSequence: Awaited<
    ReturnType<(Awaited<ReturnType<typeof getServerTRPCCaller>>)["session"]["latestSequence"]>
  >;
  let solution: Awaited<
    ReturnType<(Awaited<ReturnType<typeof getServerTRPCCaller>>)["session"]["solution"]>
  >;

  try {
    const caller = await getServerTRPCCaller();
    latestSequence = await caller.session.latestSequence({ sessionId });
    [session, solution] = await Promise.all([
      caller.session.byId({ sessionId }),
      caller.session.solution({ sessionId }),
    ]);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unable to load this session right now.";

    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-destructive">
            Session unavailable
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {errorMessage}
          </p>
          <Button asChild variant="ghost" size="sm" className="mt-4">
            <Link href="/sessions">Back to sessions</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SessionLiveView
      session={session}
      initialLastSequence={latestSequence.lastSequence}
      initialSolution={solution}
    />
  );
}
