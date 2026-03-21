"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, ChevronDown, ChevronUp, LoaderCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SessionSolution } from "@/lib/contracts/solution";

import { SolutionMarkdown } from "./solution-markdown";

type SolutionViewState = {
  status: "idle" | "generating" | "draft" | "ready" | "error";
  solution: SessionSolution | null;
  isCatchingUp: boolean;
};

type SolutionPaneProps = {
  state: SolutionViewState;
};

export function SolutionPane({ state }: SolutionPaneProps) {
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

  const showSectionControls = hasRenderableSolution && sectionCount > 1;

  return (
    <div className="relative flex h-full flex-col">
      {showSectionControls ? (
        <div className="pointer-events-none fixed right-5 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-background/80 px-1 py-1.5 shadow-md ring-1 ring-border/40 backdrop-blur-sm">
          <button
            type="button"
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-0"
            aria-label="Go to previous section"
            onClick={() => jumpToSection(-1)}
            disabled={currentSectionIndex === 0}
          >
            <ChevronUp className="size-4" />
          </button>
          <span className="text-[10px] tabular-nums text-muted-foreground/40">
            {currentSectionIndex + 1}/{sectionCount}
          </span>
          <button
            type="button"
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-0"
            aria-label="Go to next section"
            onClick={() => jumpToSection(1)}
            disabled={currentSectionIndex >= sectionCount - 1}
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8 sm:py-8"
      >
        {state.status === "idle" ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              Solution will appear once the transcript begins.
            </p>
          </div>
        ) : null}

        {state.status === "generating" && !state.solution ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground/60" />
            <p className="mt-4 text-sm text-muted-foreground">
              Generating...
            </p>
          </div>
        ) : null}

        {state.status === "generating" && hasRenderableSolution ? (
          <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            <span>Refreshing...</span>
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
  );
}
