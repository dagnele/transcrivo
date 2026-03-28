import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getRequiredSession } from "@/server/auth-session";

export default async function SessionsPage() {
  await getRequiredSession();

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-sm font-medium text-foreground">
          No sessions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a session from the sidebar to get started.
        </p>
        <Button asChild className="mt-4" size="sm">
          <Link href="/sessions?create=true">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create session
          </Link>
        </Button>
      </div>
    </div>
  );
}
