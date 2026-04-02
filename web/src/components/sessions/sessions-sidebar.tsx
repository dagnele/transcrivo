"use client";

import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { UserButton } from "@daveyplate/better-auth-ui";

import type { EntitlementSummary } from "@/lib/contracts/billing";
import type { Session } from "@/lib/contracts/session";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
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
  onCreateOpen,
  onBuySession,
  onSessionAction,
}: SessionsSidebarProps) {
  const availabilityCopy = getAvailabilityCopy(entitlementSummary);
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();

  const handleSelectSession = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar side="left" collapsible="offcanvas">
      <SidebarHeader className="gap-0 px-4 py-2.5">
        <div className="flex items-center justify-between">
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
              onClick={toggleSidebar}
              aria-label="Collapse sessions panel"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
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
                  onSelectSession={handleSelectSession}
                  onSessionAction={onSessionAction}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </SidebarContent>

      <SidebarSeparator className="mx-0" />

      <SidebarFooter className="gap-3 px-3 py-3">
        <div className="space-y-3">
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
      </SidebarFooter>
    </Sidebar>
  );
}
