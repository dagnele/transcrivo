import type {
  SessionLanguage,
  SessionType,
} from "@/lib/contracts/session";

export const sessionTypeOptions: ReadonlyArray<{
  value: SessionType;
  label: string;
}> = [
  { value: "coding", label: "Coding" },
  { value: "system_design", label: "System design" },
  { value: "writing", label: "Writing" },
  { value: "meeting", label: "Meeting" },
  { value: "brainstorm", label: "Brainstorm" },
];

export const sessionLanguageOptions: ReadonlyArray<{
  value: SessionLanguage;
  label: string;
}> = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "csharp", label: "C#" },
  { value: "kotlin", label: "Kotlin" },
  { value: "swift", label: "Swift" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
];

export function getSessionTypeLabel(type: SessionType) {
  return sessionTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function getSessionLanguageLabel(language: SessionLanguage | null) {
  if (language === null) {
    return "No language";
  }

  return (
    sessionLanguageOptions.find((option) => option.value === language)?.label ??
    language
  );
}

const solutionPaneLabels: Record<SessionType, string> = {
  coding: "Solution",
  system_design: "Design",
  writing: "Draft",
  meeting: "Summary",
  brainstorm: "Ideas",
};

export function getSolutionPaneLabel(type: SessionType): string {
  return solutionPaneLabels[type];
}
