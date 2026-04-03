"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

import { CliSetupDialog } from "@/components/sessions/cli-setup-dialog";
import { SessionLiveHeader } from "@/components/sessions/session-live-header";
import { SessionTranscriptPane } from "@/components/sessions/session-transcript-pane";
import type { TranscriptItem } from "@/components/sessions/session-transcript";
import { SolutionPane } from "@/components/sessions/session-solution-pane";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { SessionEvent } from "@/lib/contracts/event";
import {
  type SessionSolution,
  type SessionSolutionEvent,
} from "@/lib/contracts/solution";
import type { Session, SessionStatus } from "@/lib/contracts/session";
import { downloadSessionMarkdown } from "@/lib/session-ui";
import { useTRPC } from "@/lib/trpc";
import { useIsMobile } from "@/hooks/use-mobile";

const LOCAL_SESSION_DURATION_MS = 60 * 60 * 1000;
const LOCAL_TRIAL_DURATION_MS = 30 * 60 * 1000;

type SessionLiveViewProps = {
  session: Session;
  initialLastSequence: number;
  initialSolution: SessionSolution | null;
};

type LifecycleState = {
  status: SessionStatus;
  startedAt: Date | null;
  expiresAt: Date | null;
  accessKind: string | null;
  trialEndsAt: Date | null;
};

type SolutionState = {
  status: "idle" | "generating" | "draft" | "ready" | "error";
  lastVersion: number;
  solution: SessionSolution | null;
};

function applyLifecycleEvent(state: LifecycleState, event: SessionEvent): LifecycleState {
  if (event.type === "session.started") {
    const sessionDuration =
      state.accessKind === "trial" ? LOCAL_TRIAL_DURATION_MS : LOCAL_SESSION_DURATION_MS;
    const startedAt = state.startedAt ?? event.createdAt;
    return {
      ...state,
      status: "live",
      startedAt,
      expiresAt: state.expiresAt ?? new Date(event.createdAt.getTime() + sessionDuration),
      trialEndsAt:
        state.accessKind === "trial"
          ? state.trialEndsAt ?? new Date(startedAt.getTime() + LOCAL_TRIAL_DURATION_MS)
          : state.trialEndsAt,
    };
  }

  if (event.type === "session.ended") {
    const reason = typeof event.payload.reason === "string" ? event.payload.reason : null;

    if (reason === "session-expired" || reason === "trial-expired") {
      return {
        ...state,
        status: "expired",
        expiresAt: state.expiresAt ?? event.createdAt,
      };
    }

    return {
      ...state,
      status: "ended",
    };
  }

  if (event.type === "session.failed") {
    return {
      ...state,
      status: "failed",
    };
  }

  return state;
}

function getInitialSolutionState(initialSolution: SessionSolution | null): SolutionState {
  if (!initialSolution) {
    return {
      status: "idle",
      lastVersion: 0,
      solution: null,
    };
  }

  return {
    status:
      initialSolution.status === "ready"
        ? "ready"
        : initialSolution.status === "error"
          ? "error"
          : "draft",
    lastVersion: initialSolution.version,
    solution: initialSolution,
  };
}

function getInitialSolutionStateFromSession(
  session: Session,
  initialSolution: SessionSolution | null,
): SolutionState {
  const baseState = getInitialSolutionState(initialSolution);

  if (session.solutionGenerationStatus === "debouncing") {
    return {
      ...baseState,
      status: baseState.solution ? baseState.status : "generating",
    };
  }

  if (session.solutionGenerationStatus === "generating") {
    return {
      ...baseState,
      status: "generating",
    };
  }

  return baseState;
}

function applySolutionEvent(
  state: SolutionState,
  event: SessionSolutionEvent,
): SolutionState {
  if (event.payload.version < state.lastVersion) {
    return state;
  }

  if (event.payload.version === state.lastVersion && event.type === "solution.generating") {
    return state;
  }

  if (event.type === "solution.generating") {
    return {
      ...state,
      status: "generating",
      lastVersion: event.payload.version,
    };
  }

  if (event.type === "solution.failed") {
    return {
      status: "error",
      lastVersion: event.payload.version,
      solution: state.solution
        ? {
            ...state.solution,
            status: "error",
            errorMessage: event.payload.errorMessage ?? state.solution.errorMessage,
            updatedAt: event.payload.createdAt,
          }
        : {
            id: event.payload.solutionId,
            sessionId: event.payload.sessionId,
            status: "error",
            format: event.payload.format,
            content: event.payload.content ?? "",
            version: event.payload.version,
            sourceEventSequence: event.payload.sourceEventSequence,
            errorMessage: event.payload.errorMessage,
            provider: event.payload.provider,
            model: event.payload.model,
            promptVersion: event.payload.promptVersion,
            meta: event.payload.meta,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.createdAt,
          },
    };
  }

  const nextSolution: SessionSolution = {
    id: event.payload.solutionId,
    sessionId: event.payload.sessionId,
    status: event.payload.status,
    format: event.payload.format,
    content: event.payload.content,
    version: event.payload.version,
    sourceEventSequence: event.payload.sourceEventSequence,
    errorMessage: null,
    provider: event.payload.provider ?? null,
    model: event.payload.model ?? null,
    promptVersion: event.payload.promptVersion ?? null,
    meta: event.payload.meta ?? null,
    createdAt: event.payload.createdAt,
    updatedAt: event.payload.createdAt,
  };

  return {
    status: event.type === "solution.ready" ? "ready" : "draft",
    lastVersion: event.payload.version,
    solution: nextSolution,
  };
}

export function SessionLiveView({
  session,
  initialLastSequence,
  initialSolution,
}: SessionLiveViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [cliDialogOpen, setCliDialogOpen] = useState(false);
  const [lifecycleState, setLifecycleState] = useState<LifecycleState>({
    status: session.status,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    accessKind: session.accessKind,
    trialEndsAt: session.trialEndsAt,
  });
  const [transcriptLatestSequence, setTranscriptLatestSequence] = useState(0);
  const [solutionState, setSolutionState] = useState(() =>
    getInitialSolutionStateFromSession(session, initialSolution),
  );
  const [solutionEnabled, setSolutionEnabled] = useState(session.solutionEnabled);
  const toggleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialAfterVersion = initialSolution?.version;

  const toggleSolutionMutation = useMutation(trpc.session.toggleSolution.mutationOptions());

  const verticalLayout = useIsMobile();

  const handleToggleSolution = useCallback(
    (checked: boolean) => {
      setSolutionEnabled(checked);

      if (toggleDebounceRef.current) {
        clearTimeout(toggleDebounceRef.current);
      }

      toggleDebounceRef.current = setTimeout(() => {
        toggleDebounceRef.current = null;
        toggleSolutionMutation.mutate(
          { sessionId: session.id, enabled: checked },
          {
            onError() {
              setSolutionEnabled(!checked);
            },
          },
        );
      }, 5000);
    },
    [session.id, toggleSolutionMutation],
  );

  useEffect(() => {
    return () => {
      if (toggleDebounceRef.current) {
        clearTimeout(toggleDebounceRef.current);
      }
    };
  }, []);

  const handleSessionEvent = useCallback(
    async (event: SessionEvent) => {
      setLifecycleState((current) => applyLifecycleEvent(current, event));

      if (event.type === "transcript.partial" || event.type === "transcript.final") {
        setTranscriptLatestSequence((current) => Math.max(current, event.sequence));
      }

      if (
        event.type === "session.started" ||
        event.type === "session.ended" ||
        event.type === "session.failed"
      ) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.session.list.queryKey({ limit: 50 }),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.session.byId.queryKey({ sessionId: session.id }),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.billing.pathKey(),
          }),
        ]);
      }
    },
    [queryClient, session.id, trpc.billing, trpc.session.byId, trpc.session.list],
  );

  const solutionSubscription = useSubscription(
    trpc.session.solutionSubscribe.subscriptionOptions(
      {
        sessionId: session.id,
        afterVersion: initialAfterVersion,
      },
      {
        onData(event) {
          setSolutionState((current) => applySolutionEvent(current, event));
        },
      },
    ),
  );

  const isCatchingUp =
    solutionState.solution !== null &&
    transcriptLatestSequence > solutionState.solution.sourceEventSequence;

  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);

  const handleExport = useCallback(() => {
    downloadSessionMarkdown(session, transcriptItems, solutionState.solution);
  }, [session, transcriptItems, solutionState.solution]);

  return (
    <div className="flex h-full flex-col">
      <SessionLiveHeader
        session={session}
        status={lifecycleState.status}
        startedAt={lifecycleState.startedAt}
        expiresAt={lifecycleState.expiresAt}
        accessKind={lifecycleState.accessKind}
        trialEndsAt={lifecycleState.trialEndsAt}
        onOpenCli={() => setCliDialogOpen(true)}
        onExport={handleExport}
      />

      <ResizablePanelGroup
        orientation={verticalLayout ? "vertical" : "horizontal"}
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={50} minSize={25}>
          <SessionTranscriptPane
            sessionId={session.id}
            sessionType={session.type}
            initialLastSequence={initialLastSequence}
            onLatestFinalSequenceChange={setTranscriptLatestSequence}
            onEvent={(event) => {
              void handleSessionEvent(event);
            }}
            onTranscriptChange={setTranscriptItems}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={25}>
          <SolutionPane
            state={{
              status: solutionState.status,
              solution: solutionState.solution,
              isCatchingUp,
              solutionEnabled,
            }}
            sessionType={session.type}
            subscriptionStatus={solutionSubscription.status}
            onToggleSolution={handleToggleSolution}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <CliSetupDialog
        open={cliDialogOpen}
        onOpenChange={setCliDialogOpen}
        sessionId={session.id}
      />
    </div>
  );
}
