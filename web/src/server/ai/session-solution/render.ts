import type { MeetingSummaryStructured } from "@/server/ai/session-solution/schemas";

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
    ...items.map((item) => {
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
    "",
    renderBulletSection("Notes", summary.notes),
  ].join("\n");
}
