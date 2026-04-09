import type { SessionType } from "@/lib/contracts/session";

const requiredMarkdownSections: Record<SessionType, readonly string[]> = {
  coding: ["Understanding", "Approach", "Solution"],
  system_design: ["Understanding", "Approach", "Solution"],
  writing: ["Intent", "Draft"],
  meeting: [
    "Summary",
    "Decisions",
    "Action Items",
    "Risks / Blockers",
    "Open Questions",
  ],
  brainstorm: ["Goal", "Ideas", "Recommended Direction", "Next Steps"],
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
    throw new Error("The generated solution was empty.");
  }

  if (containsRawHtml(normalizedContent)) {
    throw new Error("The generated solution contained raw HTML, which is not allowed.");
  }

  const missingSections = requiredMarkdownSections[sessionType].filter(
    (section) =>
      !new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(
        normalizedContent,
      ),
  );

  if (missingSections.length > 0) {
    throw new Error(
      `The generated solution had an invalid format. Missing sections: ${missingSections.join(", ")}.`,
    );
  }

  return normalizedContent;
}
