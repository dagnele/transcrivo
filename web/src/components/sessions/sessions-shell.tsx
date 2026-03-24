"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import type { EntitlementSummary } from "@/lib/contracts/billing";
import type { Session, SessionLanguage, SessionType } from "@/lib/contracts/session";
import { useTRPC } from "@/lib/trpc";
import {
  CliSetupDialog,
  CreateSessionDialog,
  DeleteSessionDialog,
  RenameSessionDialog,
} from "@/components/sessions/session-dialogs";
import {
  SessionsSidebar,
  type SessionsListAction,
} from "@/components/sessions/sessions-sidebar";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const SIDEBAR_STORAGE_KEY = "transcrivo.sessions-sidebar-collapsed";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function getSidebarState() {
  const isDesktop = window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

  return {
    isDesktop,
    sidebarCollapsed: saved !== null ? saved === "true" : !isDesktop,
  };
}

function getActiveSessionId(pathname: string) {
  const match = pathname.match(/^\/sessions\/([^/]+)$/);
  if (!match || match[1] === "new") return null;
  return decodeURIComponent(match[1]);
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

type SessionsShellProps = {
  children: React.ReactNode;
  sessions: Session[];
  sessionsError: string | null;
  entitlements: EntitlementSummary | null;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SessionsShell({
  children,
  sessions,
  sessionsError,
  entitlements: initialEntitlements,
}: SessionsShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const activeSessionId = getActiveSessionId(pathname);

  // ---- Sidebar responsive state ----

  const [isDesktop, setIsDesktop] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncViewport = () => {
      const nextState = getSidebarState();
      setIsDesktop(nextState.isDesktop);
      setSidebarCollapsed(nextState.sidebarCollapsed);
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  const persistCollapsed = useCallback((value: boolean) => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }, [persistCollapsed]);

  const closeSidebarOnMobile = useCallback(() => {
    if (!isDesktop) {
      setSidebarCollapsed(true);
    }
  }, [isDesktop]);

  // Lock body scroll when mobile overlay is open
  useEffect(() => {
    if (!isDesktop && !sidebarCollapsed) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isDesktop, sidebarCollapsed]);

  // ---- Data queries ----

  const sessionsQuery = useQuery(
    trpc.session.list.queryOptions(
      { limit: 50 },
      {
        initialData: {
          items: sessions,
          nextCursor: null,
        },
      },
    ),
  );
  const visibleSessions = sessionsQuery.data?.items ?? sessions;
  const visibleSessionsError =
    sessionsError ?? (sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null);

  const entitlementsQuery = useQuery(
    trpc.billing.entitlements.queryOptions(undefined, {
      initialData: initialEntitlements ?? undefined,
    }),
  );
  const entitlementSummary = entitlementsQuery.data ?? initialEntitlements;

  // ---- Billing ----

  const [buyPending, setBuyPending] = useState(false);

  const handleBuySession = useCallback(async () => {
    setBuyPending(true);
    try {
      await authClient.checkout({
        slug: "session",
        successUrl: `${window.location.origin}/sessions?checkout=success`,
      });
    } catch {
      // ignore
    } finally {
      setBuyPending(false);
    }
  }, []);

  // ---- Mutations ----

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.session.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.billing.pathKey() }),
    ]);
    router.refresh();
  }, [queryClient, router, trpc]);

  const createMutation = useMutation(trpc.session.create.mutationOptions({}));
  const updateMutation = useMutation(trpc.session.update.mutationOptions({}));
  const deleteMutation = useMutation(trpc.session.delete.mutationOptions({}));

  const handleCreate = useCallback(
    async (input: { title: string; type: SessionType; language: SessionLanguage | null }) => {
      const session = await createMutation.mutateAsync(input);
      closeSidebarOnMobile();
      await invalidateAll();
      router.push(`/sessions/${session.id}`);
    },
    [closeSidebarOnMobile, createMutation, invalidateAll, router],
  );

  const handleRename = useCallback(
    async (input: {
      sessionId: string;
      title: string;
      type: SessionType;
      language: SessionLanguage | null;
    }) => {
      await updateMutation.mutateAsync(input);
      await invalidateAll();
    },
    [invalidateAll, updateMutation],
  );

  const handleDelete = useCallback(
    async (sessionId: string) => {
      await deleteMutation.mutateAsync({ sessionId });
      if (sessionId === activeSessionId) {
        router.push("/sessions");
      }
      await invalidateAll();
    },
    [activeSessionId, deleteMutation, invalidateAll, router],
  );

  // ---- Dialog state ----

  const [createOpen, setCreateOpen] = useState(false);
  const [renameSession, setRenameSession] = useState<Session | null>(null);
  const [deleteSession, setDeleteSession] = useState<Session | null>(null);
  const [cliSession, setCliSession] = useState<Session | null>(null);

  const handleSessionAction = useCallback(
    (action: SessionsListAction, session: Session) => {
      switch (action) {
        case "cli":
          setCliSession(session);
          break;
        case "rename":
          setRenameSession(session);
          break;
        case "delete":
          setDeleteSession(session);
          break;
      }
    },
    [],
  );

  // ---- Render ----

  return (
    <div className="flex h-screen">
      <SessionsSidebar
        sessions={visibleSessions}
        sessionsError={visibleSessionsError}
        activeSessionId={activeSessionId}
        entitlementSummary={entitlementSummary}
        buyPending={buyPending}
        isDesktop={isDesktop}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onCloseMobile={closeSidebarOnMobile}
        onCreateOpen={() => setCreateOpen(true)}
        onBuySession={() => void handleBuySession()}
        onSessionAction={handleSessionAction}
      />

      {/* Main content */}
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="absolute inset-y-0 left-0 z-10 flex w-6 items-center justify-center bg-transparent opacity-0 transition-opacity hover:bg-sidebar/50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            onClick={toggleSidebar}
            aria-label="Show sessions panel"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : null}
        {children}
      </main>

      {/* Dialogs */}
      <CreateSessionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        entitlementSummary={entitlementSummary}
        buyPending={buyPending}
        onBuySession={() => void handleBuySession()}
        onCreate={handleCreate}
      />

      <RenameSessionDialog
        session={renameSession}
        onClose={() => setRenameSession(null)}
        onRename={handleRename}
      />

      <DeleteSessionDialog
        session={deleteSession}
        onClose={() => setDeleteSession(null)}
        onDelete={handleDelete}
      />

      <CliSetupDialog
        open={cliSession !== null}
        onOpenChange={(open) => {
          if (!open) setCliSession(null);
        }}
        sessionId={cliSession?.id ?? ""}
      />
    </div>
  );
}
