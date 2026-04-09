import type {
  CodingSolutionStructured,
  MeetingSummaryStructured,
  SystemDesignSolutionStructured,
  WritingSolutionStructured,
} from "@/server/ai/session-solution/schemas";

function renderBulletSection(title: string, items: readonly string[]) {
  if (items.length === 0) {
    return [`## ${title}`, "None captured."].join("\n");
  }

  return [`## ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
}

function renderMeetingActionItems(items: MeetingSummaryStructured["actionItems"]) {
  if (items.length === 0) {
    return ["## Action Items", "None captured."].join("\n");
  }

  return [
    "## Action Items",
    ...items.map((item: MeetingSummaryStructured["actionItems"][number]) => {
      const qualifiers = [
        item.owner ? `owner: ${item.owner}` : null,
        item.deadline ? `deadline: ${item.deadline}` : null,
      ].filter((value): value is string => value !== null);

      if (qualifiers.length === 0) {
        return `- ${item.task}`;
      }

      return `- ${item.task} (${qualifiers.join(", ")})`;
    }),
  ].join("\n");
}

function renderTextSection(title: string, content: string) {
  return [`## ${title}`, content.trim()].join("\n");
}

function renderOptionalTextSection(title: string, content: string) {
  const normalized = content.trim();

  if (!normalized) {
    return null;
  }

  return renderTextSection(title, normalized);
}

export function renderCodingSolutionMarkdown(solution: CodingSolutionStructured) {
  return [
    renderTextSection("Understanding", solution.understanding),
    "",
    renderTextSection("Approach", solution.approach),
    "",
    renderTextSection("Solution", solution.solution),
    renderOptionalTextSection("Notes", solution.notes),
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}

export function renderSystemDesignSolutionMarkdown(
  solution: SystemDesignSolutionStructured,
) {
  return [
    renderTextSection("Understanding", solution.understanding),
    "",
    renderTextSection("Approach", solution.approach),
    "",
    renderTextSection("Solution", solution.solution),
    renderOptionalTextSection("Notes", solution.notes),
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}

export function renderWritingSolutionMarkdown(solution: WritingSolutionStructured) {
  return [
    renderTextSection("Intent", solution.intent),
    "",
    renderTextSection("Draft", solution.draft),
    renderOptionalTextSection("Notes", solution.notes),
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}

export function renderMeetingSummaryMarkdown(summary: MeetingSummaryStructured) {
  return [
    renderBulletSection("Summary", summary.summary),
    "",
    renderBulletSection("Decisions", summary.decisions),
    "",
    renderMeetingActionItems(summary.actionItems),
    "",
    renderBulletSection("Risks / Blockers", summary.risks),
    "",
    renderBulletSection("Open Questions", summary.openQuestions),
    summary.notes.length > 0 ? "" : null,
    summary.notes.length > 0 ? renderBulletSection("Notes", summary.notes) : null,
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}
