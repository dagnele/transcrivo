"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";

import { ScrollArea } from "@/components/ui/scroll-area";
import { ScrollNav } from "@/components/ui/scroll-nav";
import type { SessionEvent } from "@/lib/contracts/event";
import type { SessionType } from "@/lib/contracts/session";
import { formatTimecode, getConnectionLabel } from "@/lib/session-ui";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
import { cn } from "@/lib/utils";

import {
  getSpeakerLabel,
  getTranscriptItemFromEvent,
  mergeTranscriptItem,
  mergeTranscriptWindows,
  normalizeTranscriptEvents,
  type TranscriptItem,
} from "./session-transcript";

const INITIAL_PAGE_LIMIT = 50;
const NEAR_BOTTOM_THRESHOLD_PX = 80;
const JUMP_SCROLL_OFFSET_PX = 480;

type SessionTranscriptPaneProps = {
  sessionId: string;
  sessionType: SessionType;
  initialLastSequence: number;
  onLatestFinalSequenceChange: (sequence: number) => void;
  onEvent: (event: SessionEvent) => void;
};

function getRemainingScrollDistance(viewport: HTMLDivElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

export function SessionTranscriptPane({
  sessionId,
  sessionType,
  initialLastSequence,
  onLatestFinalSequenceChange,
  onEvent,
}: SessionTranscriptPaneProps) {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollHeightRef = useRef<number | null>(null);
  const [liveItems, setLiveItems] = useState<TranscriptItem[]>([]);
  const [lastSequence, setLastSequence] = useState(initialLastSequence);
  const [isNearTop, setIsNearTop] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const transcriptPagesQuery = useInfiniteQuery({
    queryKey: trpc.session.transcriptPage.queryKey({ sessionId, limit: INITIAL_PAGE_LIMIT }),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      trpcClient.session.transcriptPage.query({
        sessionId,
        limit: INITIAL_PAGE_LIMIT,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 10_000,
  });

  const pagedTranscriptItems = useMemo(() => {
    const pages = transcriptPagesQuery.data?.pages ?? [];

    return pages.reduce<TranscriptItem[]>((items, page) => {
      const pageItems = normalizeTranscriptEvents([...page.items].reverse());
      return mergeTranscriptWindows(items, pageItems);
    }, []);
  }, [transcriptPagesQuery.data]);

  const transcriptItems = useMemo(() => {
    return liveItems.reduce<TranscriptItem[]>(mergeTranscriptItem, pagedTranscriptItems);
  }, [liveItems, pagedTranscriptItems]);

  const latestFinalSequence = useMemo(() => {
    return transcriptItems.reduce(
      (max, item) => (item.status === "final" ? Math.max(max, item.sequence) : max),
      0,
    );
  }, [transcriptItems]);

  const hasOlderTranscript = transcriptPagesQuery.hasNextPage ?? false;
  const isFetchingOlderTranscript = transcriptPagesQuery.isFetchingNextPage;

  const updateScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    setIsNearTop(viewport.scrollTop < NEAR_BOTTOM_THRESHOLD_PX);
    setIsNearBottom(getRemainingScrollDistance(viewport) < NEAR_BOTTOM_THRESHOLD_PX);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomAnchorRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const scrollTowardOlder = useCallback(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollBy({ top: -JUMP_SCROLL_OFFSET_PX, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    updateScrollPosition();
    viewport.addEventListener("scroll", updateScrollPosition, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", updateScrollPosition);
    };
  }, [updateScrollPosition]);

  useEffect(() => {
    if (transcriptPagesQuery.status !== "success") {
      return;
    }

    if (pendingScrollHeightRef.current !== null) {
      const viewport = viewportRef.current;

      if (viewport) {
        const heightDelta = viewport.scrollHeight - pendingScrollHeightRef.current;
        viewport.scrollTop += heightDelta;
      }

      pendingScrollHeightRef.current = null;
      return;
    }

    scrollToLatest("auto");
  }, [scrollToLatest, transcriptPagesQuery.data, transcriptPagesQuery.status]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || !topSentinelRef.current || !hasOlderTranscript) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (!entry?.isIntersecting || isFetchingOlderTranscript) {
          return;
        }

        pendingScrollHeightRef.current = viewport.scrollHeight;
        void transcriptPagesQuery.fetchNextPage();
      },
      {
        root: viewport,
        threshold: 0.1,
      },
    );

    observer.observe(topSentinelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasOlderTranscript, isFetchingOlderTranscript, transcriptPagesQuery]);

  useEffect(() => {
    if (transcriptItems.length === 0) {
      return;
    }

    if (isNearBottom) {
      scrollToLatest("smooth");
    }
  }, [isNearBottom, scrollToLatest, transcriptItems]);

  useEffect(() => {
    onLatestFinalSequenceChange(latestFinalSequence);
  }, [latestFinalSequence, onLatestFinalSequenceChange]);

  const transcriptSubscription = useSubscription(
    trpc.session.subscribe.subscriptionOptions(
      {
        sessionId,
        afterSequence: lastSequence,
      },
      {
        onData(event) {
          onEvent(event);
          setLastSequence((current) => Math.max(current, event.sequence));

          const nextItem = getTranscriptItemFromEvent(event);

          if (!nextItem) {
            return;
          }

          setLiveItems((current) => mergeTranscriptItem(current, nextItem));
        },
      },
    ),
  );

  const connectionLabel = getConnectionLabel(transcriptSubscription.status);
  const transcriptCountLabel = `${transcriptItems.length} loaded`;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Transcript
        </p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
          <span>{connectionLabel}</span>
          <span>{transcriptCountLabel}</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <ScrollNav
          onUp={scrollTowardOlder}
          onDown={() => scrollToLatest("smooth")}
          upDisabled={isNearTop && !hasOlderTranscript}
          downDisabled={isNearBottom}
        />

        <ScrollArea className="h-full" viewportRef={viewportRef}>
          {transcriptPagesQuery.status === "pending" ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
              </div>
            </div>
          ) : transcriptItems.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground/40">Waiting for transcript</p>
            </div>
          ) : (
            <div className="px-6 py-5">
              <div ref={topSentinelRef} className="h-px w-full" aria-hidden="true" />

              {isFetchingOlderTranscript ? (
                <div className="mb-4 flex justify-center">
                  <div className="flex gap-1">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
                  </div>
                </div>
              ) : null}

              <div className="space-y-4">
                {transcriptItems.map((entry) => {
                  const label = getSpeakerLabel(sessionType, entry.source, entry.speaker);
                  const isYou = entry.source === "mic";

                  return (
                    <div key={entry.id}>
                      <div className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isYou ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {label}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/40">
                          {formatTimecode(entry.startMs)}
                        </span>
                        {entry.status === "partial" ? (
                          <span className="text-[10px] text-muted-foreground/30 italic">...</span>
                        ) : null}
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

                <div ref={bottomAnchorRef} />
              </div>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
