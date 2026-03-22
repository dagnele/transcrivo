import { Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Session, SessionStatus } from "@/lib/contracts/session";
import { getSessionLanguageLabel, getSessionTypeLabel } from "@/lib/session-config";

import { SessionStatusBadge } from "./session-status-badge";

type SessionLiveHeaderProps = {
  session: Session;
  status: SessionStatus;
  startedAt: Date | null;
  expiresAt: Date | null;
  onOpenCli: () => void;
};

export function SessionLiveHeader({
  session,
  status,
  startedAt,
  expiresAt,
  onOpenCli,
}: SessionLiveHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-2.5">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-medium text-foreground">{session.title}</h1>
        <span className="text-xs text-muted-foreground">
          {getSessionTypeLabel(session.type)}
          {session.type === "coding" ? ` / ${getSessionLanguageLabel(session.language)}` : null}
        </span>
        <SessionStatusBadge
          status={status}
          createdAt={session.createdAt}
          startedAt={startedAt}
          expiresAt={expiresAt}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={onOpenCli}
        >
          <Terminal className="h-3 w-3" />
          CLI
        </Button>
      </div>
    </header>
  );
}
