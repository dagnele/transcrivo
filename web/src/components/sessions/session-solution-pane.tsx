"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollNav } from "@/components/ui/scroll-nav";
import { Switch } from "@/components/ui/switch";
import type { SessionType } from "@/lib/contracts/session";
import type { SessionSolution } from "@/lib/contracts/solution";
import { getSolutionPaneLabel } from "@/lib/session-config";
import { getConnectionLabel } from "@/lib/session-ui";

import { PaneEmptyState, PaneLoadingDots } from "./session-pane-states";
import { SolutionMarkdown } from "./solution-markdown";

type SolutionViewState = {
  status: "idle" | "generating" | "draft" | "ready" | "error";
  solution: SessionSolution | null;
  isCatchingUp: boolean;
  solutionEnabled: boolean;
};

type SolutionPaneProps = {
  state: SolutionViewState;
  sessionType: SessionType;
  subscriptionStatus: string;
  onToggleSolution: (checked: boolean) => void;
};

export function SolutionPane({ state, sessionType, subscriptionStatus, onToggleSolution }: SolutionPaneProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const solution = state.solution;
  const hasRenderableSolution =
    solution !== null && solution.content.trim().length > 0;
  const [sectionIndex, setSectionIndex] = useState(0);

  const sectionCount = useMemo(() => {
    if (!hasRenderableSolution) {
      return 0;
    }

    if (!solution) {
      return 0;
    }

    return (solution.content.match(/^#{1,3}\s+/gm) ?? []).length;
  }, [hasRenderableSolution, solution]);
  const currentSectionIndex = Math.min(sectionIndex, Math.max(sectionCount - 1, 0));

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container || !hasRenderableSolution) {
      return;
    }

    const getSections = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-solution-section='true']")
      );

    const updateActiveSection = () => {
      const sections = getSections();

      if (sections.length === 0) {
        setSectionIndex(0);
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      let nextIndex = 0;

      sections.forEach((section, index) => {
        if (section.getBoundingClientRect().top - containerTop <= 24) {
          nextIndex = index;
        }
      });

      setSectionIndex(nextIndex);
    };

    updateActiveSection();
    container.addEventListener("scroll", updateActiveSection, { passive: true });

    return () => {
      container.removeEventListener("scroll", updateActiveSection);
    };
  }, [hasRenderableSolution, solution?.content]);

  const jumpToSection = (direction: -1 | 1) => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const sections = Array.from(
      container.querySelectorAll<HTMLElement>("[data-solution-section='true']")
    );

    if (sections.length === 0) {
      return;
    }

    const nextIndex = Math.max(
      0,
      Math.min(sections.length - 1, currentSectionIndex + direction)
    );
    sections[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSectionIndex(nextIndex);
  };

  const showSectionLabel = hasRenderableSolution && sectionCount > 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {getSolutionPaneLabel(sessionType)}
        </p>
        <div className="flex items-center gap-3">
          {subscriptionStatus !== "pending" ? (
            <span className="text-[11px] text-muted-foreground/60 capitalize">
              {getConnectionLabel(subscriptionStatus)}
            </span>
          ) : null}
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground/60">AI</span>
            <Switch size="sm" checked={state.solutionEnabled} onCheckedChange={onToggleSolution} />
          </label>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollNav
          label={showSectionLabel ? `${currentSectionIndex + 1}/${sectionCount}` : undefined}
          onUp={() => jumpToSection(-1)}
          onDown={() => jumpToSection(1)}
          upDisabled={currentSectionIndex === 0}
          downDisabled={!hasRenderableSolution || currentSectionIndex >= sectionCount - 1}
        />

        <div
          ref={scrollContainerRef}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-8"
        >
          {state.status === "idle" ? (
            <PaneEmptyState
              icon={Sparkles}
              message={state.solutionEnabled ? "Waiting for transcript" : "AI generation is off"}
            />
          ) : null}

          {state.status === "generating" && !state.solution ? (
            <div className="flex h-full items-center justify-center">
              <PaneLoadingDots />
            </div>
          ) : null}

          {state.status === "generating" && hasRenderableSolution ? (
            <div className="sticky top-0 z-10 flex items-center justify-center border-b border-border/20 bg-background/80 py-2 backdrop-blur-sm">
              <PaneLoadingDots size="sm" />
              <span className="ml-2 text-[11px] text-muted-foreground">Updating...</span>
            </div>
          ) : null}

          {hasRenderableSolution && solution ? (
            <div>
              {state.status === "draft" ? (
                <Badge variant="outline" className="mb-4 text-amber-600">
                  Draft
                </Badge>
              ) : null}
              {state.isCatchingUp && state.status !== "error" ? (
                <p className="mb-4 text-xs text-muted-foreground">
                  Catching up to transcript...
                </p>
              ) : null}
              {state.status === "error" ? (
                <div className="mb-4 flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {solution.errorMessage ?? "Refresh failed. Showing last snapshot."}
                  </span>
                </div>
              ) : null}
              <SolutionMarkdown content={solution.content} />
            </div>
          ) : null}

          {state.status === "error" && !hasRenderableSolution ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <AlertCircle className="h-5 w-5 text-destructive/60" />
              <p className="mt-4 text-sm text-muted-foreground">
                {state.solution?.errorMessage ?? "Generation failed."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
