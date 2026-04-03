import type { SessionType } from "@/lib/contracts/session";

const requiredMarkdownSections: Record<SessionType, readonly string[]> = {
  coding: ["Understanding", "Approach", "Solution", "Notes"],
  system_design: ["Understanding", "Approach", "Solution", "Notes"],
  writing: ["Intent", "Draft", "Notes"],
  meeting_summary: [
    "Summary",
    "Decisions",
    "Action Items",
    "Risks / Blockers",
    "Open Questions",
    "Notes",
  ],
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFencedCodeBlocks(content: string) {
  return content.replace(/```[\s\S]*?```/g, "");
}

function containsRawHtml(content: string) {
  const normalized = stripFencedCodeBlocks(content);

  return /<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/.test(normalized);
}

export function validateGeneratedSolution(
  sessionType: SessionType,
  content: string,
) {
  const normalizedContent = content.trim();

  if (!normalizedContent) {
    throw new Error("The AI provider returned an empty solution.");
  }

  if (containsRawHtml(normalizedContent)) {
    throw new Error("The AI provider returned raw HTML, which is not allowed.");
  }

  const missingSections = requiredMarkdownSections[sessionType].filter(
    (section) =>
      !new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(
        normalizedContent,
      ),
  );

  if (missingSections.length > 0) {
    throw new Error(
      `The AI provider returned an invalid solution format. Missing sections: ${missingSections.join(", ")}.`,
    );
  }

  return normalizedContent;
}
