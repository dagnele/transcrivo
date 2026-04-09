import type {
  BrainstormStructured,
  CodingSolutionStructured,
  MeetingStructured,
  SystemDesignSolutionStructured,
  WritingSolutionStructured,
} from "@/server/ai/session-solution/schemas";

function renderBulletSection(title: string, items: readonly string[]) {
  if (items.length === 0) {
    return [`## ${title}`, "None captured."].join("\n");
  }

  return [`## ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
}

function renderMeetingActionItems(items: MeetingStructured["actionItems"]) {
  if (items.length === 0) {
    return ["## Action Items", "None captured."].join("\n");
  }

  return [
    "## Action Items",
    ...items.map((item: MeetingStructured["actionItems"][number]) => {
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

export function renderMeetingMarkdown(meeting: MeetingStructured) {
  return [
    renderBulletSection("Summary", meeting.summary),
    "",
    renderBulletSection("Decisions", meeting.decisions),
    "",
    renderMeetingActionItems(meeting.actionItems),
    "",
    renderBulletSection("Risks / Blockers", meeting.risks),
    "",
    renderBulletSection("Open Questions", meeting.openQuestions),
    meeting.notes.length > 0 ? "" : null,
    meeting.notes.length > 0 ? renderBulletSection("Notes", meeting.notes) : null,
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}

export function renderBrainstormMarkdown(brainstorm: BrainstormStructured) {
  return [
    renderTextSection("Goal", brainstorm.goal),
    "",
    renderBulletSection("Ideas", brainstorm.ideas),
    "",
    renderTextSection("Recommended Direction", brainstorm.recommendedDirection),
    "",
    renderBulletSection("Next Steps", brainstorm.nextSteps),
    brainstorm.notes.length > 0 ? "" : null,
    brainstorm.notes.length > 0 ? renderBulletSection("Notes", brainstorm.notes) : null,
  ]
    .filter((section): section is string => section !== null)
    .join("\n");
}
