import { redirect } from "next/navigation";

import { getServerTRPCCaller } from "@/server/api/caller";
import { getRequiredSession } from "@/server/auth-session";

export default async function SessionsPage() {
  await getRequiredSession();

  try {
    const caller = await getServerTRPCCaller();
    const data = await caller.session.list({ limit: 1 });

    if (data.items[0]) {
      redirect(`/sessions/${data.items[0].id}`);
    }
  } catch {
    // Fall through to empty state
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-sm font-medium text-foreground">
          No sessions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a session from the sidebar to get started.
        </p>
      </div>
    </div>
  );
}
