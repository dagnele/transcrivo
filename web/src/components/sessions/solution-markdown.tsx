"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";
import { MermaidDiagram } from "./mermaid-diagram";
import { ShikiCode } from "./shiki-code";

function createHeadingId(value: string, usedIds: Map<string, number>) {
  const baseId = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";

  const count = usedIds.get(baseId) ?? 0;
  usedIds.set(baseId, count + 1);

  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

type SolutionMarkdownProps = {
  content: string;
  className?: string;
};

type HeadingProps = React.ComponentPropsWithoutRef<"h1"> & {
  node?: unknown;
};

export function SolutionMarkdown({
  content,
  className,
}: SolutionMarkdownProps) {
  const usedIdsRef = React.useRef(new Map<string, number>());
  const usedIds = usedIdsRef.current;

  const getHeadingText = (children: React.ReactNode): string =>
    React.Children.toArray(children)
      .map((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return String(child);
        }

        if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
          return getHeadingText(child.props.children);
        }

        return "";
      })
      .join(" ")
      .trim();

  const renderHeading = (
    tag: "h1" | "h2" | "h3",
    levelClassName: string,
    headingClassName: string | undefined,
    props: HeadingProps
  ) => {
    const { node: _node, ...elementProps } = props;
    void _node;
    const headingText = getHeadingText(props.children);
    const id = createHeadingId(headingText, usedIds);

    return React.createElement(tag, {
      ...elementProps,
      id,
      "data-solution-section": "true",
      className: cn(levelClassName, headingClassName),
    });
  };

  return (
    <div className={cn("solution-markdown text-sm leading-relaxed text-foreground/85", className)}>
      <ReactMarkdown
        components={{
          h1: ({ className: headingClassName, ...props }) => (
            renderHeading("h1", "mt-8 text-lg font-medium first:mt-0", headingClassName, props)
          ),
          h2: ({ className: headingClassName, ...props }) => (
            renderHeading("h2", "mt-8 text-base font-medium first:mt-0", headingClassName, props)
          ),
          h3: ({ className: headingClassName, ...props }) => (
            renderHeading("h3", "mt-6 text-sm font-medium first:mt-0", headingClassName, props)
          ),
          p: ({ className: paragraphClassName, ...props }) => (
            <p
              className={cn(
                "mt-3 leading-7 first:mt-0",
                paragraphClassName,
              )}
              {...props}
            />
          ),
          ul: ({ className: listClassName, ...props }) => (
            <ul
              className={cn(
                "mt-3 list-disc space-y-1.5 pl-5",
                listClassName,
              )}
              {...props}
            />
          ),
          ol: ({ className: listClassName, ...props }) => (
            <ol
              className={cn(
                "mt-3 list-decimal space-y-1.5 pl-5",
                listClassName,
              )}
              {...props}
            />
          ),
          li: ({ className: itemClassName, ...props }) => (
            <li className={cn("pl-0.5", itemClassName)} {...props} />
          ),
          blockquote: ({ className: blockquoteClassName, ...props }) => (
            <blockquote
              className={cn(
                "mt-4 border-l-2 border-border/60 pl-4 text-muted-foreground",
                blockquoteClassName,
              )}
              {...props}
            />
          ),
          code: ({
            className: codeClassName,
            children,
            ...props
          }) => {
            const normalizedClassName = codeClassName ?? "";
            const renderedText = String(children).replace(/\n$/, "");
            const inline =
              !normalizedClassName.includes("language-") &&
              !renderedText.includes("\n");

            if (inline) {
              return (
                <code
                  className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            const language = normalizedClassName.replace("language-", "") || "text";

            if (language === "mermaid") {
              return <MermaidDiagram chart={renderedText} />;
            }

            return (
              <div className="mt-4 overflow-hidden rounded-lg border border-border/50 bg-zinc-950 text-zinc-50">
                {language && language !== "text" ? (
                  <div className="border-b border-white/5 px-3 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                      {language}
                    </span>
                  </div>
                ) : null}
                <ShikiCode code={renderedText} language={language} />
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
