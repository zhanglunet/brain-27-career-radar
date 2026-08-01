import type { CandidateDraft, ChangeDecision, OpportunityPatch, OpportunityRow } from "./types.ts";

const HIGH_RISK = new Set(["deadline", "status", "kind"]);
const MEDIUM_RISK = new Set(["name", "org", "location"]);

export function decideOpportunityChange(candidate: CandidateDraft, current: OpportunityRow | null): ChangeDecision | null {
  const proposed: OpportunityPatch = {
    name: candidate.title,
    org: candidate.org,
    ...(candidate.kind ? { kind: candidate.kind } : {}),
    ...(candidate.status ? { status: candidate.status } : {}),
    ...(candidate.location ? { location: candidate.location } : {}),
    ...(candidate.deadline ? { deadline: candidate.deadline } : {}),
    url: candidate.canonicalUrl,
  };

  if (!current) {
    return { patch: proposed, riskLevel: "high", changedFields: Object.keys(proposed).sort() };
  }

  const patch: OpportunityPatch = {};
  for (const [field, value] of Object.entries(proposed)) {
    if (normalize(String(current[field as keyof OpportunityRow] ?? "")) !== normalize(String(value))) {
      Object.assign(patch, { [field]: value });
    }
  }
  const changedFields = Object.keys(patch).sort();
  if (changedFields.length === 0) return null;
  const riskLevel = changedFields.some((field) => HIGH_RISK.has(field))
    ? "high"
    : changedFields.some((field) => MEDIUM_RISK.has(field))
      ? "medium"
      : "low";
  return { patch, riskLevel, changedFields };
}

export function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
