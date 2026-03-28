import Link from "next/link";
import { Hash, MoreHorizontal, Pencil, Terminal, Trash2 } from "lucide-react";

import type { Session } from "@/lib/contracts/session";
import type { SessionsListAction } from "./sessions-sidebar";
import {
  getSessionLanguageLabel,
  getSessionTypeLabel,
} from "@/lib/session-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SessionStatusBadge } from "@/components/sessions/session-status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SessionCardProps = {
  session: Session;
  isActive: boolean;
  onCloseMobile: () => void;
  onSessionAction: (action: SessionsListAction, session: Session) => void;
};

export function SessionCard({
  session,
  isActive,
  onCloseMobile,
  onSessionAction,
}: SessionCardProps) {
  return (
    <div
      className={cn(
        "group rounded-md transition-colors min-w-0 overflow-hidden",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      <Link
        href={`/sessions/${session.id}`}
        className="flex items-center gap-2 px-2.5 py-1.5 w-full min-w-0 overflow-hidden"
        onClick={onCloseMobile}
      >
        <Hash className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
        <div className="min-w-0 flex-1 w-0">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm" title={session.title}>
              {session.title}
            </p>
            <SessionStatusBadge
              status={session.status}
              createdAt={session.createdAt}
              startedAt={session.startedAt}
              expiresAt={session.expiresAt}
              className="shrink-0 h-4 px-1 text-[10px] capitalize"
              popoverAlign="end"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSessionAction("cli", session);
                  }}
                >
                  <Terminal className="mr-2 h-3.5 w-3.5" />
                  Connect via CLI
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSessionAction("rename", session);
                  }}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSessionAction("delete", session);
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {getSessionTypeLabel(session.type)}
            {session.type === "coding" ? ` / ${getSessionLanguageLabel(session.language)}` : null}
          </span>
        </div>
      </Link>
    </div>
  );
}
