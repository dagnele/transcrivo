"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, createContext, useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function getActiveSessionId(pathname: string) {
  const match = pathname.match(/^\/sessions\/([^/]+)$/);
  if (!match || match[1] === "new") return null;
  return decodeURIComponent(match[1]);
}

function isSessionsIndex(pathname: string) {
  return pathname === "/sessions";
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type SessionsSidebarContextValue = {
  isDesktop: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
};

const SessionsSidebarContext = createContext<SessionsSidebarContextValue | null>(null);

export function useSessionsSidebar() {
  const context = useContext(SessionsSidebarContext);
  if (!context) {
    throw new Error("useSessionsSidebar must be used within SessionsShell");
  }
  return context;
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
  const activeSessionIdFromUrl = getActiveSessionId(pathname);
  const isIndex = isSessionsIndex(pathname);

  const activeSessionId = activeSessionIdFromUrl;

  // ---- Sidebar responsive state ----

  const [isDesktop, setIsDesktop] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = () => {
      setIsDesktop(mediaQuery.matches);
    };

    setIsDesktop(mediaQuery.matches);

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((current) => !current);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // Lock body scroll when mobile overlay is open
  useEffect(() => {
    if (!isDesktop && sidebarOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isDesktop, sidebarOpen]);

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

  useEffect(() => {
    if (isIndex && visibleSessions.length > 0 && !activeSessionIdFromUrl) {
      router.push(`/sessions/${visibleSessions[0].id}`);
    }
  }, [isIndex, visibleSessions, activeSessionIdFromUrl, router]);

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
      closeSidebar();
      await invalidateAll();
      router.push(`/sessions/${session.id}`);
    },
    [closeSidebar, createMutation, invalidateAll, router],
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

  const sidebarContextValue: SessionsSidebarContextValue = {
    isDesktop,
    sidebarOpen,
    toggleSidebar,
    closeSidebar,
  };

  return (
    <SessionsSidebarContext.Provider value={sidebarContextValue}>
      <div className="flex h-screen">
        <SessionsSidebar
          sessions={visibleSessions}
          sessionsError={visibleSessionsError}
          activeSessionId={activeSessionId}
          entitlementSummary={entitlementSummary}
          buyPending={buyPending}
          isDesktop={isDesktop}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onCloseMobile={closeSidebar}
          onCreateOpen={() => setCreateOpen(true)}
          onBuySession={() => void handleBuySession()}
          onSessionAction={handleSessionAction}
        />

        {/* Main content */}
        <main className="relative min-w-0 flex-1 overflow-y-auto">
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
    </SessionsSidebarContext.Provider>
  );
}
