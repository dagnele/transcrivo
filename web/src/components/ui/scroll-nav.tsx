"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

type ScrollNavProps = {
  label?: string;
  upDisabled?: boolean;
  downDisabled?: boolean;
  onUp: () => void;
  onDown: () => void;
  className?: string;
};

export function ScrollNav({
  label,
  upDisabled,
  downDisabled,
  onUp,
  onDown,
  className,
}: ScrollNavProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-3 right-3 z-20 flex flex-col items-center rounded-full bg-background px-0.5 py-0.5 shadow-lg ring-1 ring-border backdrop-blur-md",
        className,
      )}
    >
      <button
        type="button"
        className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:text-muted-foreground/30 disabled:hover:bg-transparent"
        aria-label="Navigate up"
        onClick={onUp}
        disabled={upDisabled}
      >
        <ArrowUp className="size-3" />
      </button>
      {label !== undefined ? (
        <span className="text-[9px] font-medium tabular-nums text-muted-foreground">
          {label}
        </span>
      ) : null}
      <button
        type="button"
        className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:text-muted-foreground/30 disabled:hover:bg-transparent"
        aria-label="Navigate down"
        onClick={onDown}
        disabled={downDisabled}
      >
        <ArrowDown className="size-3" />
      </button>
    </div>
  );
}
