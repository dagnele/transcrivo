"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type MermaidDiagramProps = {
  chart: string;
  className?: string;
};

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, "-");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        // Dynamic import so mermaid is only loaded client-side and keeps
        // the initial bundle small.
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          fontFamily: "inherit",
          securityLevel: "strict",
        });

        const { svg } = await mermaid.render(
          `mermaid-${uniqueId}`,
          chart.trim(),
        );

        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to render diagram",
          );
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId]);

  if (error) {
    return (
      <div className={cn("mt-4 overflow-hidden rounded-lg border border-border/50 bg-zinc-950 text-zinc-50", className)}>
        <div className="border-b border-white/5 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            mermaid
          </span>
        </div>
        <pre className="overflow-x-auto p-4 text-xs text-zinc-400">
          <code>{chart}</code>
        </pre>
        <div className="border-t border-white/5 px-3 py-1.5 text-xs text-red-400">
          Diagram parse error — showing source
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-4 overflow-hidden rounded-lg border border-border/50 bg-zinc-950 text-zinc-50",
        className,
      )}
    >
      <div className="border-b border-white/5 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
          diagram
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex items-center justify-center overflow-x-auto p-4 [&_svg]:max-w-full"
      />
    </div>
  );
}
