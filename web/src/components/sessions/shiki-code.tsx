"use client";

import { useEffect, useRef, useState } from "react";
import { type BundledLanguage, type Highlighter, createHighlighter } from "shiki";

const THEME = "vitesse-dark";

const COMMON_LANGS: BundledLanguage[] = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "go",
  "rust",
  "sql",
  "html",
  "css",
  "json",
  "bash",
  "shell",
  "markdown",
  "yaml",
  "tsx",
  "jsx",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: COMMON_LANGS,
    });
  }
  return highlighterPromise;
}

async function loadLanguage(
  highlighter: Highlighter,
  lang: string,
): Promise<boolean> {
  const loaded = highlighter.getLoadedLanguages();
  if (loaded.includes(lang)) return true;

  try {
    await highlighter.loadLanguage(lang as BundledLanguage);
    return true;
  } catch {
    return false;
  }
}

type ShikiCodeProps = {
  code: string;
  language: string;
};

export function ShikiCode({ code, language }: ShikiCodeProps) {
  const [html, setHtml] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const highlighter = await getHighlighter();
      if (cancelled) return;

      const lang = language.toLowerCase();
      const supported = await loadLanguage(highlighter, lang);
      if (cancelled) return;

      const rendered = highlighter.codeToHtml(code, {
        lang: supported ? lang : "text",
        theme: THEME,
      });

      if (!cancelled && mountedRef.current) {
        setHtml(rendered);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (html) {
    return (
      <div
        className="shiki-code overflow-x-auto text-xs leading-6 [&_pre]:!bg-transparent [&_pre]:p-4 [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback while shiki loads
  return (
    <div className="overflow-x-auto">
      <pre className="p-4 text-xs leading-6">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
