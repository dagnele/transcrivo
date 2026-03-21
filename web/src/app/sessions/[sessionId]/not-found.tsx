import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function SessionNotFoundPage() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">
          Session not found
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This session does not exist or has been deleted.
        </p>
        <Button asChild variant="ghost" size="sm" className="mt-4">
          <Link href="/sessions">Back to sessions</Link>
        </Button>
      </div>
    </div>
  );
}
