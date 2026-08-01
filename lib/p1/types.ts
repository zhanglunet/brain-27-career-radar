export const opportunityKinds = ["博士", "联培博士", "科研助理", "校招", "实习", "研究岗位"] as const;
export const opportunityStatuses = ["立即行动", "等待开放", "持续关注"] as const;

export type OpportunityKind = typeof opportunityKinds[number];
export type OpportunityStatus = typeof opportunityStatuses[number];
export type CandidateField = "title" | "org" | "kind" | "location" | "deadline" | "status" | "url";

export type EvidenceDraft = {
  fieldName: CandidateField;
  fieldValue: string;
  excerpt: string;
  extractor: "json-ld" | "meta" | "heading" | "anchor" | "text-rule" | "source-profile";
  confidence: number;
};

export type CandidateDraft = {
  canonicalUrl: string;
  title: string;
  org: string;
  kind: OpportunityKind | null;
  location: string | null;
  deadline: string | null;
  status: OpportunityStatus | null;
  evidence: EvidenceDraft[];
  metadata: Record<string, string | number | boolean | null>;
};

export type SourceDocument = {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  finalUrl: string;
  sourceType: "detail" | "listing" | "api" | "rss";
  adapterKey: string;
  html: string;
};

export type SourceAdapter = {
  key: string;
  mode: "detail" | "listing";
  extract(document: SourceDocument): CandidateDraft[];
};

export type OpportunityRow = {
  id: string;
  name: string;
  org: string;
  kind: OpportunityKind;
  status: OpportunityStatus;
  location: string;
  deadline: string;
  url: string;
};

export type OpportunityPatch = Partial<{
  name: string;
  org: string;
  kind: OpportunityKind;
  status: OpportunityStatus;
  location: string;
  deadline: string;
  url: string;
}>;

export type ChangeDecision = {
  patch: OpportunityPatch;
  riskLevel: "low" | "medium" | "high";
  changedFields: string[];
};
