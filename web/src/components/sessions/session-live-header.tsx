"use client";

import { useEffect, useState } from "react";
import { Download, PanelLeft, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Session, SessionStatus } from "@/lib/contracts/session";
import { getSessionLanguageLabel, getSessionTypeLabel } from "@/lib/session-config";
import { cn } from "@/lib/utils";

import { SessionStatusBadge } from "./session-status-badge";
import type { TranscriptItem } from "./session-transcript";
import type { SessionSolution } from "@/lib/contracts/solution";
import { downloadSessionMarkdown } from "@/lib/session-ui";

type SessionLiveHeaderProps = {
  session: Session;
  status: SessionStatus;
  startedAt: Date | null;
  expiresAt: Date | null;
  accessKind: string | null;
  trialEndsAt: Date | null;
  showSidebarToggle: boolean;
  onToggleSidebar: () => void;
  onOpenCli: () => void;
  transcriptItems?: TranscriptItem[];
  solution?: SessionSolution | null;
};

function formatTrialRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function TrialCountdown({ trialEndsAt }: { trialEndsAt: Date }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, trialEndsAt.getTime() - Date.now()),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Math.max(0, trialEndsAt.getTime() - Date.now());
      setRemaining(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [trialEndsAt]);

  const isWarning = remaining > 0 && remaining <= 60_000;
  const isExpired = remaining <= 0;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        isExpired
          ? "bg-destructive/10 text-destructive"
          : isWarning
            ? "animate-pulse bg-orange-500/10 text-orange-600 dark:text-orange-400"
            : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
      )}
    >
      Trial {isExpired ? "ended" : formatTrialRemaining(remaining)}
    </span>
  );
}

export function SessionLiveHeader({
  session,
  status,
  startedAt,
  expiresAt,
  accessKind,
  trialEndsAt,
  showSidebarToggle,
  onToggleSidebar,
  onOpenCli,
  transcriptItems = [],
  solution = null,
}: SessionLiveHeaderProps) {
  const isTrial = accessKind === "trial";
  const showTrialCountdown = isTrial && trialEndsAt && status !== "draft";

  const handleExport = () => {
    downloadSessionMarkdown(session, transcriptItems, solution);
  };

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-2.5">
      <div className="flex items-center gap-3">
        {showSidebarToggle ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleSidebar}
            aria-label="Show sessions panel"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        ) : null}
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
        {isTrial && !showTrialCountdown ? (
          <span className="inline-flex items-center rounded-md bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
            Trial
          </span>
        ) : null}
        {showTrialCountdown ? (
          <TrialCountdown trialEndsAt={trialEndsAt} />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={handleExport}
        >
          <Download className="h-3 w-3" />
          Export
        </Button>
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
