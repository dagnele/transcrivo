"use client";

import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { UserButton } from "@daveyplate/better-auth-ui";

import type { EntitlementSummary } from "@/lib/contracts/billing";
import type { Session } from "@/lib/contracts/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionCard } from "./session-card";

function getAvailabilityCopy(summary: EntitlementSummary | null) {
  if (!summary) {
    return {
      label: "Checking availability",
      detail: "Refresh if this does not update.",
    };
  }

  if (summary.availablePurchasedSessions > 0) {
    return {
      label: `${summary.availablePurchasedSessions} paid session${summary.availablePurchasedSessions === 1 ? "" : "s"}`,
      detail: "Used when a draft session starts.",
    };
  }

  if (summary.trialAvailable) {
    return {
      label: "Free trial available",
      detail: "Your next started session can use the 5 min trial.",
    };
  }

  return {
    label: "No sessions available",
    detail: "Buy more to start another session.",
  };
}

export type SessionsListAction = "cli" | "rename" | "delete";

type SessionsSidebarProps = {
  sessions: Session[];
  sessionsError: string | null;
  activeSessionId: string | null;
  entitlementSummary: EntitlementSummary | null;
  buyPending: boolean;
  isDesktop: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCloseMobile: () => void;
  onCreateOpen: () => void;
  onBuySession: () => void;
  onSessionAction: (action: SessionsListAction, session: Session) => void;
};

export function SessionsSidebar({
  sessions,
  sessionsError,
  activeSessionId,
  entitlementSummary,
  buyPending,
  isDesktop,
  sidebarCollapsed,
  onToggleSidebar,
  onCloseMobile,
  onCreateOpen,
  onBuySession,
  onSessionAction,
}: SessionsSidebarProps) {
  const availabilityCopy = getAvailabilityCopy(entitlementSummary);

  return (
    <>
      {!isDesktop && !sidebarCollapsed ? (
        <button
          type="button"
          aria-label="Close sessions panel"
          className="absolute inset-0 z-20 bg-black/50 backdrop-blur-[1px]"
          onClick={onToggleSidebar}
        />
      ) : null}

      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-30 flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width,transform,border-color] duration-200 ease-out lg:relative lg:z-auto",
          isDesktop
            ? sidebarCollapsed
              ? "w-0 border-r-transparent"
              : "w-72 translate-x-0"
            : sidebarCollapsed
              ? "w-72 -translate-x-full shadow-none"
              : "w-72 translate-x-0 shadow-2xl",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4">
          <Link
            href="/sessions"
            className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-sidebar-foreground"
          >
            Transcrivo
          </Link>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCreateOpen}
              aria-label="Create session"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSidebar}
              aria-label="Collapse sessions panel"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Session list */}
        <ScrollArea className="flex-1 px-2">
          {sessionsError ? (
            <p className="px-2 py-4 text-xs text-destructive">
              {sessionsError}
            </p>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No sessions yet
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                onClick={onCreateOpen}
              >
                <Plus className="mr-1 h-3 w-3" />
                Create one
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5 pb-4 min-w-0 overflow-hidden">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onCloseMobile={onCloseMobile}
                  onSessionAction={onSessionAction}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          <div className="rounded-md border bg-background/70 px-3 py-2">
            <p className="text-xs font-medium text-foreground">{availabilityCopy.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{availabilityCopy.detail}</p>
            <Button
              variant={entitlementSummary?.availablePurchasedSessions ? "outline" : "default"}
              size="sm"
              className="mt-3 w-full"
              onClick={onBuySession}
              disabled={buyPending}
            >
              {buyPending ? "Redirecting..." : "Buy more"}
            </Button>
          </div>

          <UserButton
            size="sm"
            variant="ghost"
            className="w-full justify-start"
          />
        </div>
      </aside>
    </>
  );
}
