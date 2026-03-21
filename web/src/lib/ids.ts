function generatePrefixedId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function generateSessionId() {
  return generatePrefixedId("sess");
}

export function generateSessionSolutionId() {
  return generatePrefixedId("sol");
}

export function generateRecordId() {
  return generatePrefixedId("rec");
}
