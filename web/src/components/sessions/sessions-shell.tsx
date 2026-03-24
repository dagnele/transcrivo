"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  MoreHorizontal,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import type { EntitlementSummary } from "@/lib/contracts/billing";
import type { Session, SessionLanguage, SessionType } from "@/lib/contracts/session";
import {
  getSessionLanguageLabel,
  getSessionTypeLabel,
  sessionLanguageOptions,
  sessionTypeOptions,
} from "@/lib/session-config";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CliSetupDialog } from "@/components/sessions/cli-setup-dialog";
import { SessionStatusBadge } from "@/components/sessions/session-status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

type SessionsShellProps = {
  children: React.ReactNode;
  sessions: Session[];
  sessionsError: string | null;
  entitlements: EntitlementSummary | null;
};

const SIDEBAR_STORAGE_KEY = "transcrivo.sessions-sidebar-collapsed";
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";
const DEFAULT_SESSION_TYPE: SessionType = "coding";
const DEFAULT_SESSION_LANGUAGE: SessionLanguage = "python";

function normalizeSessionLanguage(type: SessionType, language: SessionLanguage | null) {
  return type === "coding" ? (language ?? DEFAULT_SESSION_LANGUAGE) : null;
}

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
  const [isDesktop, setIsDesktop] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  // Billing entitlements
  const entitlementsQuery = useQuery(
    trpc.billing.entitlements.queryOptions(undefined, {
      initialData: initialEntitlements ?? undefined,
    }),
  );
  const entitlementSummary = entitlementsQuery.data ?? initialEntitlements;
  const availabilityCopy = getAvailabilityCopy(entitlementSummary);

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

  // Create session dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createType, setCreateType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
  const [createLanguage, setCreateLanguage] = useState<SessionLanguage | null>(
    DEFAULT_SESSION_LANGUAGE,
  );
  const [createPending, setCreatePending] = useState(false);

  // Rename session dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameType, setRenameType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
  const [renameLanguage, setRenameLanguage] = useState<SessionLanguage | null>(
    DEFAULT_SESSION_LANGUAGE,
  );
  const [renameSession, setRenameSession] = useState<Session | null>(null);
  const [renamePending, setRenamePending] = useState(false);

  // Delete confirmation dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSession, setDeleteSession] = useState<Session | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // CLI setup dialog
  const [cliSession, setCliSession] = useState<Session | null>(null);

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

  const createMutation = useMutation(
    trpc.session.create.mutationOptions({
      onSuccess: async (session) => {
        setCreateOpen(false);
        setCreateTitle("");
        setCreateType(DEFAULT_SESSION_TYPE);
        setCreateLanguage(DEFAULT_SESSION_LANGUAGE);
        closeSidebarOnMobile();
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.session.pathKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.billing.pathKey(),
          }),
        ]);
        router.push(`/sessions/${session.id}`);
        router.refresh();
      },
    }),
  );

  const updateMutation = useMutation(
    trpc.session.update.mutationOptions({
      onSuccess: async () => {
        setRenameOpen(false);
        setRenameSession(null);
        await queryClient.invalidateQueries({
          queryKey: trpc.session.pathKey(),
        });
        router.refresh();
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.session.delete.mutationOptions({
      onSuccess: async (_, variables) => {
        setDeleteOpen(false);
        if (variables.sessionId === activeSessionId) {
          router.push("/sessions");
        }
        setDeleteSession(null);
        await queryClient.invalidateQueries({
          queryKey: trpc.session.pathKey(),
        });
        router.refresh();
      },
    }),
  );

  const handleCreate = useCallback(async () => {
    if (!createTitle.trim()) return;
    setCreatePending(true);
    try {
      await createMutation.mutateAsync({
        title: createTitle.trim(),
        type: createType,
        language: normalizeSessionLanguage(createType, createLanguage),
      });
    } catch {
      // ignore
    } finally {
      setCreatePending(false);
    }
  }, [createLanguage, createMutation, createTitle, createType]);

  const handleUpdate = useCallback(async () => {
    if (!renameSession || !renameTitle.trim()) return;
    setRenamePending(true);
    try {
      await updateMutation.mutateAsync({
        sessionId: renameSession.id,
        title: renameTitle.trim(),
        type: renameType,
        language: normalizeSessionLanguage(renameType, renameLanguage),
      });
    } catch {
      // ignore
    } finally {
      setRenamePending(false);
    }
  }, [renameLanguage, renameSession, renameTitle, renameType, updateMutation]);

  const handleDelete = useCallback(async () => {
    if (!deleteSession) return;
    setDeletePending(true);
    try {
      await deleteMutation.mutateAsync({ sessionId: deleteSession.id });
    } catch {
      // ignore
    } finally {
      setDeletePending(false);
    }
  }, [deleteMutation, deleteSession]);

  function openRename(session: Session) {
    setRenameSession(session);
    setRenameTitle(session.title);
    setRenameType(session.type);
    setRenameLanguage(session.language);
    setRenameOpen(true);
  }

  function openDelete(session: Session) {
    setDeleteSession(session);
    setDeleteOpen(true);
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      {!isDesktop && !sidebarCollapsed ? (
        <button
          type="button"
          aria-label="Close sessions panel"
          className="absolute inset-0 z-20 bg-black/50 backdrop-blur-[1px]"
          onClick={toggleSidebar}
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
          <h1 className="text-sm font-semibold text-sidebar-foreground">
            Sessions
          </h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCreateOpen(true)}
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

        {/* Session list */}
        <ScrollArea className="flex-1 px-2">
          {visibleSessionsError ? (
            <p className="px-2 py-4 text-xs text-destructive">
              {visibleSessionsError}
            </p>
          ) : visibleSessions.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No sessions yet
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1 h-3 w-3" />
                Create one
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5 pb-4">
              {visibleSessions.map((session) => {
                const isActive = session.id === activeSessionId;

                return (
                  <div
                    key={session.id}
                    className={cn(
                      "group rounded-md transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <Link
                      href={`/sessions/${session.id}`}
                      className="flex items-center gap-2 px-2.5 py-1.5"
                      onClick={closeSidebarOnMobile}
                    >
                      <Hash className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm">
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
                                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
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
                                  setCliSession(session);
                                }}
                              >
                                <Terminal className="mr-2 h-3.5 w-3.5" />
                                Connect via CLI
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openRename(session);
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
                                  openDelete(session);
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
              })}
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-border/60 px-3 py-3">
          <div className="rounded-md border bg-background/70 px-3 py-2">
            <p className="text-xs font-medium text-foreground">{availabilityCopy.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{availabilityCopy.detail}</p>
            <Button
              variant={entitlementSummary?.availablePurchasedSessions ? "outline" : "default"}
              size="sm"
              className="mt-3 w-full"
              onClick={() => void handleBuySession()}
              disabled={buyPending}
            >
              {buyPending ? "Redirecting..." : "Buy more"}
            </Button>
          </div>
        </div>
      </aside>

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

      {/* Create session dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New session</DialogTitle>
            <DialogDescription>
              Give your session a short, descriptive title.
            </DialogDescription>
          </DialogHeader>

          {/* Entitlement status banner */}
          {entitlementSummary ? (
            <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              {entitlementSummary.availablePurchasedSessions > 0 ? (
                <p>
                  You have{" "}
                  <span className="font-medium text-foreground">
                    {entitlementSummary.availablePurchasedSessions}
                  </span>{" "}
                  paid session{entitlementSummary.availablePurchasedSessions !== 1 ? "s" : ""}{" "}
                  available.
                </p>
              ) : entitlementSummary.trialAvailable ? (
                <p>
                  You can create a draft now. Billing is decided when the session starts, and you still have a{" "}
                  <span className="font-medium text-foreground">Free trial (5 min)</span>.
                </p>
              ) : (
                <p>
                  No sessions available.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => void handleBuySession()}
                    disabled={buyPending}
                  >
                    {buyPending ? "Redirecting..." : "Buy a session"}
                  </button>{" "}
                  to continue.
                </p>
              )}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="create-session-title">Title</Label>
              <Input
                id="create-session-title"
                placeholder="e.g. Frontend system design"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Session type</Label>
              <Select
                value={createType}
                onValueChange={(value: string) => {
                  const nextType = value as SessionType;
                  const nextLanguage =
                    nextType === "coding"
                      ? createLanguage ?? DEFAULT_SESSION_LANGUAGE
                      : null;
                  setCreateType(nextType);
                  setCreateLanguage(nextLanguage);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Coding language</Label>
              <Select
                value={createLanguage ?? ""}
                onValueChange={(value: string) => setCreateLanguage(value as SessionLanguage)}
                disabled={createType !== "coding"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={createType !== "coding" ? "No language" : undefined} />
                </SelectTrigger>
                <SelectContent>
                  {sessionLanguageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!createTitle.trim() || createPending}
              >
                {createPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename session dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Update the title for this session.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUpdate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="rename-session-title">Title</Label>
              <Input
                id="rename-session-title"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Session type</Label>
              <Select
                value={renameType}
                onValueChange={(value: string) => {
                  const nextType = value as SessionType;
                  const nextLanguage =
                    nextType === "coding"
                      ? renameLanguage ?? DEFAULT_SESSION_LANGUAGE
                      : null;
                  setRenameType(nextType);
                  setRenameLanguage(nextLanguage);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Coding language</Label>
              <Select
                value={renameLanguage ?? ""}
                onValueChange={(value: string) => setRenameLanguage(value as SessionLanguage)}
                disabled={renameType !== "coding"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={renameType !== "coding" ? "No language" : undefined} />
                </SelectTrigger>
                <SelectContent>
                  {sessionLanguageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!renameTitle.trim() || renamePending}
              >
                {renamePending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete session confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{deleteSession?.title}&rdquo; and all its transcript data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="!bg-destructive !text-white hover:!bg-destructive/90"
              disabled={deletePending}
              onClick={() => void handleDelete()}
            >
              {deletePending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CLI setup dialog */}
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
