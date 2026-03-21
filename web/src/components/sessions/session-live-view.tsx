"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CliSetupDialog } from "@/components/sessions/cli-setup-dialog";
import { SolutionPane } from "@/components/sessions/solution-pane";
import {
  transcriptEventPayloadSchema,
  type SessionEvent,
} from "@/lib/contracts/event";
import {
  type SessionSolution,
  type SessionSolutionEvent,
} from "@/lib/contracts/solution";
import type { Session, SessionStatus } from "@/lib/contracts/session";
import {
  formatTimecode,
  getConnectionLabel,
  getStatusVariant,
} from "@/lib/session-ui";
import { getSessionLanguageLabel, getSessionTypeLabel } from "@/lib/session-config";
import { useTRPC } from "@/lib/trpc";

type TranscriptItem = {
  id: string;
  utteranceId: string;
  sequence: number;
  speaker: string;
  source: string;
  text: string;
  status: "partial" | "final";
  startMs: number;
  endMs: number;
};

type SessionLiveViewProps = {
  session: Session;
  initialHistory: SessionEvent[];
  initialSolution: SessionSolution | null;
};

type SessionState = {
  status: SessionStatus;
  lastSequence: number;
  transcript: TranscriptItem[];
};

type SolutionState = {
  status: "idle" | "generating" | "draft" | "ready" | "error";
  lastVersion: number;
  solution: SessionSolution | null;
};

function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  if (event.sequence <= state.lastSequence) {
    return state;
  }

  if (event.type === "session.started") {
    return { ...state, status: "live", lastSequence: event.sequence };
  }

  if (event.type === "session.ended") {
    return { ...state, status: "ended", lastSequence: event.sequence };
  }

  if (event.type === "session.failed") {
    return { ...state, status: "failed", lastSequence: event.sequence };
  }

  if (event.type !== "transcript.partial" && event.type !== "transcript.final") {
    return { ...state, lastSequence: event.sequence };
  }

  const payload = transcriptEventPayloadSchema.safeParse(event.payload);
  if (!payload.success) {
    return { ...state, lastSequence: event.sequence };
  }

  const nextTranscript = [...state.transcript];
  const isFinalEvent = event.type === "transcript.final";

  const nextItem: TranscriptItem = {
    id: event.id,
    utteranceId: payload.data.utteranceId,
    sequence: event.sequence,
    speaker: payload.data.speaker,
    source: payload.data.source,
    text: payload.data.text,
    status: isFinalEvent ? "final" : "partial",
    startMs: payload.data.startMs,
    endMs: payload.data.endMs,
  };

  const overlapsSameSourcePartial = (item: TranscriptItem) =>
    item.status === "partial" &&
    item.source === nextItem.source &&
    item.startMs <= nextItem.endMs &&
    item.endMs >= nextItem.startMs;

  const sameUtterance = (item: TranscriptItem) => item.utteranceId === payload.data.utteranceId;

  const overlapsSameSource = (item: TranscriptItem) =>
    item.source === nextItem.source &&
    item.startMs <= nextItem.endMs &&
    item.endMs >= nextItem.startMs;

  const normalizedTranscript = isFinalEvent
    ? nextTranscript.filter((item) => !overlapsSameSourcePartial(item))
    : nextTranscript.filter(
        (item) =>
          item.status === "final" ||
          (!sameUtterance(item) && !overlapsSameSourcePartial(item)),
      );

  const existingIndex = normalizedTranscript.findIndex(
    (item) => sameUtterance(item) || (item.status === "partial" && overlapsSameSource(item)),
  );

  if (existingIndex >= 0) {
    normalizedTranscript[existingIndex] = nextItem;
  } else {
    normalizedTranscript.push(nextItem);
  }

  normalizedTranscript.sort((left, right) => left.sequence - right.sequence);

  return {
    ...state,
    lastSequence: event.sequence,
    transcript: normalizedTranscript,
  };
}

function buildInitialState(
  session: Session,
  history: SessionEvent[],
): SessionState {
  return history.reduce<SessionState>(
    (state, event) => applyEvent(state, event),
    { status: session.status, lastSequence: 0, transcript: [] },
  );
}

function getSpeakerLabel(source: string, speaker: string) {
  if (source === "mic") return "You";
  if (source === "system") return "Interviewer";
  return speaker;
}

function getInitialSolutionState(
  initialSolution: SessionSolution | null,
): SolutionState {
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

function applySolutionEvent(
  state: SolutionState,
  event: SessionSolutionEvent,
): SolutionState {
  if (event.payload.version < state.lastVersion) {
    return state;
  }

  if (
    event.payload.version === state.lastVersion &&
    event.type === "solution.generating"
  ) {
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
            errorMessage:
              event.payload.errorMessage ?? state.solution.errorMessage,
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
    errorMessage: undefined,
    provider: event.payload.provider,
    model: event.payload.model,
    promptVersion: event.payload.promptVersion,
    meta: event.payload.meta,
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
  initialHistory,
  initialSolution,
}: SessionLiveViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [cliDialogOpen, setCliDialogOpen] = useState(false);

  const initialState = useMemo(
    () => buildInitialState(session, initialHistory),
    [initialHistory, session],
  );
  const [sessionState, setSessionState] = useState(initialState);
  const [solutionState, setSolutionState] = useState(() =>
    getInitialSolutionState(initialSolution),
  );
  const initialAfterSequence = initialState.lastSequence;
  const initialAfterVersion = initialSolution?.version;

  useSubscription(
    trpc.session.subscribe.subscriptionOptions(
      {
        sessionId: session.id,
        afterSequence: initialAfterSequence,
      },
      {
        async onData(event) {
          setSessionState((current) => applyEvent(current, event));

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
            ]);
          }
        },
      },
    ),
  );

  const solutionSubscription = useSubscription(
    trpc.session.solutionSubscribe.subscriptionOptions(
      {
        sessionId: session.id,
        afterVersion: initialAfterVersion,
      },
      {
        async onData(event) {
          setSolutionState((current) => applySolutionEvent(current, event));
        },
      },
    ),
  );

  const latestFinalTranscriptSequence = useMemo(() => {
    return sessionState.transcript.reduce(
      (max, item) => (item.status === "final" ? Math.max(max, item.sequence) : max),
      0,
    );
  }, [sessionState.transcript]);

  const isCatchingUp =
    solutionState.solution !== null &&
    latestFinalTranscriptSequence > solutionState.solution.sourceEventSequence;

  // Auto-scroll to bottom on new transcript entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionState.transcript.length]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium text-foreground">
            {session.title}
          </h1>
          <span className="text-xs text-muted-foreground">
            {getSessionTypeLabel(session.type)}
            {session.type === "coding"
              ? ` / ${getSessionLanguageLabel(session.language)}`
              : null}
          </span>
          <Badge
            variant={getStatusVariant(sessionState.status)}
            className="capitalize"
          >
            {sessionState.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setCliDialogOpen(true)}
          >
            <Terminal className="h-3 w-3" />
            CLI
          </Button>
        </div>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* Transcript */}
        <ResizablePanel defaultSize={50} minSize={25}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Transcript
              </p>
              <span className="text-[11px] text-muted-foreground/60">
                {sessionState.transcript.length > 0
                  ? `${sessionState.transcript.length} utterances`
                  : null}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {sessionState.transcript.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6">
                  <p className="text-sm text-muted-foreground/60">
                    Waiting for transcript...
                  </p>
                </div>
              ) : (
                <div className="px-6 py-5">
                  <div className="space-y-4">
                    {sessionState.transcript.map((entry) => {
                      const label = getSpeakerLabel(entry.source, entry.speaker);
                      const isYou = entry.source === "mic";

                      return (
                        <div key={entry.utteranceId}>
                          <div className="flex items-baseline gap-2">
                            <span
                              className={cn(
                                "text-xs font-medium",
                                isYou
                                  ? "text-primary"
                                  : "text-muted-foreground",
                              )}
                            >
                              {label}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground/40">
                              {formatTimecode(entry.startMs)}
                            </span>
                            {entry.status === "partial" && (
                              <span className="text-[10px] text-muted-foreground/30 italic">
                                ...
                              </span>
                            )}
                          </div>
                          <p
                            className={cn(
                              "mt-0.5 text-sm leading-relaxed",
                              entry.status === "partial"
                                ? "text-foreground/40 italic"
                                : "text-foreground/85",
                            )}
                          >
                            {entry.text}
                          </p>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Solution */}
        <ResizablePanel defaultSize={50} minSize={25}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Solution
              </p>
              {solutionSubscription.status !== "pending" ? (
                <span className="text-[11px] text-muted-foreground/60 capitalize">
                  {getConnectionLabel(solutionSubscription.status)}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              <SolutionPane
                state={{
                  status: solutionState.status,
                  solution: solutionState.solution,
                  isCatchingUp,
                }}
              />
            </div>
          </div>
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
