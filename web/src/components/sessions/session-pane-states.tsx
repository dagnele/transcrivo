import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type PaneLoadingDotsProps = {
  size?: "sm" | "md";
};

/**
 * Pulsing dots used for loading indicators inside session panes.
 *
 * - `"md"` (default) — centered full-panel spinner (initial load / generating without content).
 * - `"sm"` — compact inline spinner (fetching older pages, generating with content already visible).
 */
export function PaneLoadingDots({ size = "md" }: PaneLoadingDotsProps) {
  const dot = size === "sm" ? "h-1 w-1" : "h-1.5 w-1.5";

  return (
    <div className="flex gap-1">
      <span className={cn("animate-pulse rounded-full bg-muted-foreground/40", dot)} />
      <span
        className={cn(
          "animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]",
          dot,
        )}
      />
      <span
        className={cn(
          "animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]",
          dot,
        )}
      />
    </div>
  );
}

type PaneEmptyStateProps = {
  icon: LucideIcon;
  message: string;
};

/** Centered icon + message shown when a pane has no content yet. */
export function PaneEmptyState({ icon: Icon, message }: PaneEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Icon className="h-4 w-4 text-muted-foreground/30" />
      <p className="mt-3 text-xs text-muted-foreground/40">{message}</p>
    </div>
  );
}
