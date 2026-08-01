import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceType: text("source_type", { enum: ["detail", "listing", "api", "rss"] }).notNull(),
  coverage: text("coverage", { enum: ["phd", "campus", "mixed"] }).notNull().default("mixed"),
  organizationType: text("organization_type", { enum: ["university", "research", "company", "platform"] }).notNull().default("platform"),
  regionsJson: text("regions_json").notNull().default("[]"),
  topicsJson: text("topics_json").notNull().default("[]"),
  description: text("description").notNull().default(""),
  priority: text("priority", { enum: ["normal", "high", "critical"] }).notNull().default("normal"),
  adapterKey: text("adapter_key"),
  discoveryEnabled: integer("discovery_enabled", { mode: "boolean" }).notNull().default(false),
  autoMergeLowRisk: integer("auto_merge_low_risk", { mode: "boolean" }).notNull().default(false),
  url: text("url").notNull(),
  trustLevel: integer("trust_level").notNull().default(100),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  checkIntervalHours: integer("check_interval_hours").notNull().default(24),
  etag: text("etag"),
  lastModified: text("last_modified"),
  contentHash: text("content_hash"),
  finalUrl: text("final_url"),
  lastStatusCode: integer("last_status_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("sources_url_unique").on(table.url),
  index("sources_enabled_idx").on(table.enabled),
  index("sources_priority_idx").on(table.priority, table.enabled),
]);

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  org: text("org").notNull(),
  kind: text("kind", { enum: ["博士", "联培博士", "科研助理", "校招", "实习", "研究岗位"] }).notNull(),
  status: text("status", { enum: ["立即行动", "等待开放", "持续关注"] }).notNull(),
  fit: text("fit", { enum: ["高度匹配", "匹配", "转型匹配"] }).notNull(),
  location: text("location").notNull(),
  deadline: text("deadline").notNull(),
  fundingType: text("funding_type", { enum: ["full", "partial", "mixed", "self_funded", "unknown"] }).notNull().default("unknown"),
  fundingDetails: text("funding_details").notNull().default("资助情况待官方确认"),
  fundingVerifiedAt: text("funding_verified_at"),
  mastersEligible: integer("masters_eligible", { mode: "boolean" }).notNull().default(false),
  eligibilityDetails: text("eligibility_details").notNull().default("以官方岗位要求为准"),
  phdBridgeDetails: text("phd_bridge_details"),
  why: text("why").notNull(),
  action: text("action").notNull(),
  tagsJson: text("tags_json").notNull().default("[]"),
  url: text("url").notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  index("opportunities_published_idx").on(table.published),
  index("opportunities_source_idx").on(table.sourceId),
]);

export const institutions = sqliteTable("institutions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  mark: text("mark").notNull(),
  summary: text("summary").notNull(),
  note: text("note").notNull(),
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  index("institutions_published_idx").on(table.published, table.sortOrder),
  index("institutions_source_idx").on(table.sourceId),
]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["cron", "manual", "test"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  checkedCount: integer("checked_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sourceSnapshots = sqliteTable("source_snapshots", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  statusCode: integer("status_code").notNull(),
  finalUrl: text("final_url").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  capturedAt: text("captured_at").notNull(),
}, (table) => [
  index("snapshots_source_idx").on(table.sourceId, table.capturedAt),
  uniqueIndex("snapshots_source_hash_unique").on(table.sourceId, table.contentHash),
]);

export const sourceCheckLogs = sqliteTable("source_check_logs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => syncRuns.id, { onDelete: "cascade" }),
  checkedAt: text("checked_at").notNull(),
  outcome: text("outcome", { enum: ["unchanged", "changed", "not_modified", "failed"] }).notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  changed: integer("changed", { mode: "boolean" }).notNull().default(false),
  statusCode: integer("status_code"),
  finalUrl: text("final_url"),
  errorSummary: text("error_summary"),
  candidatesCount: integer("candidates_count").notNull().default(0),
  evidenceCount: integer("evidence_count").notNull().default(0),
  changeSetsCount: integer("change_sets_count").notNull().default(0),
  appliedCount: integer("applied_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("source_check_logs_run_source_unique").on(table.runId, table.sourceId),
  index("source_check_logs_checked_idx").on(table.checkedAt),
  index("source_check_logs_source_idx").on(table.sourceId, table.checkedAt),
  index("source_check_logs_outcome_idx").on(table.outcome, table.checkedAt),
]);

export const reviewQueue = sqliteTable("review_queue", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  runId: text("run_id").references(() => syncRuns.id, { onDelete: "set null" }),
  reason: text("reason", { enum: ["content_changed", "repeated_failure", "new_source", "parse_conflict"] }).notNull(),
  status: text("status", { enum: ["pending", "observing", "approved", "rejected"] }).notNull().default("pending"),
  reviewMode: text("review_mode", { enum: ["automatic", "human"] }).notNull().default("human"),
  payloadJson: text("payload_json").notNull().default("{}"),
  resolutionCode: text("resolution_code"),
  resolutionNote: text("resolution_note"),
  resolvedBy: text("resolved_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("review_queue_status_idx").on(table.status, table.createdAt),
]);

export const candidateRecords = sqliteTable("candidate_records", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").references(() => sourceSnapshots.id, { onDelete: "set null" }),
  canonicalUrl: text("canonical_url").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  org: text("org").notNull(),
  kind: text("kind", { enum: ["博士", "联培博士", "科研助理", "校招", "实习", "研究岗位"] }),
  location: text("location"),
  deadline: text("deadline"),
  opportunityStatus: text("opportunity_status", { enum: ["立即行动", "等待开放", "持续关注"] }),
  extractedJson: text("extracted_json").notNull().default("{}"),
  state: text("state", { enum: ["observed", "review", "published", "rejected"] }).notNull().default("observed"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("candidate_records_dedupe_unique").on(table.dedupeKey),
  index("candidate_records_source_idx").on(table.sourceId, table.lastSeenAt),
  index("candidate_records_state_idx").on(table.state, table.lastSeenAt),
]);

export const fieldEvidence = sqliteTable("field_evidence", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull().references(() => candidateRecords.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").references(() => sourceSnapshots.id, { onDelete: "set null" }),
  fieldName: text("field_name").notNull(),
  fieldValue: text("field_value").notNull(),
  excerpt: text("excerpt").notNull(),
  extractor: text("extractor").notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("field_evidence_value_unique").on(table.candidateId, table.snapshotId, table.fieldName, table.fieldValue),
  index("field_evidence_candidate_idx").on(table.candidateId, table.fieldName),
]);

export const changeSets = sqliteTable("change_sets", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull().references(() => candidateRecords.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  runId: text("run_id").references(() => syncRuns.id, { onDelete: "set null" }),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high"] }).notNull(),
  status: text("status", { enum: ["pending", "applied", "rejected", "superseded"] }).notNull().default("pending"),
  patchJson: text("patch_json").notNull(),
  patchHash: text("patch_hash").notNull(),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  uniqueIndex("change_sets_patch_unique").on(table.candidateId, table.patchHash),
  index("change_sets_status_idx").on(table.status, table.riskLevel, table.createdAt),
]);

export const researchers = sqliteTable("researchers", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameZh: text("name_zh"),
  institution: text("institution").notNull(),
  department: text("department").notNull().default(""),
  role: text("role").notNull().default(""),
  region: text("region", { enum: ["CN", "HK", "UK", "US", "EU", "OTHER"] }).notNull(),
  city: text("city").notNull().default(""),
  profileUrl: text("profile_url").notNull(),
  labUrl: text("lab_url"),
  cvUrl: text("cv_url"),
  topicsJson: text("topics_json").notNull().default("[]"),
  methodsJson: text("methods_json").notNull().default("[]"),
  summary: text("summary").notNull(),
  applicationValue: text("application_value").notNull().default(""),
  recruitmentStatus: text("recruitment_status", { enum: ["open", "watch", "unknown", "closed"] }).notNull().default("unknown"),
  priority: text("priority", { enum: ["normal", "high", "critical"] }).notNull().default("normal"),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("researchers_slug_unique").on(table.slug),
  index("researchers_region_idx").on(table.region, table.priority),
  index("researchers_published_idx").on(table.published, table.priority),
]);

export const researcherIdentities = sqliteTable("researcher_identities", {
  id: text("id").primaryKey(),
  researcherId: text("researcher_id").notNull().references(() => researchers.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["orcid", "crossref", "europe_pmc", "openalex", "google_scholar", "semantic_scholar"] }).notNull(),
  externalId: text("external_id").notNull(),
  profileUrl: text("profile_url"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  verifiedAt: text("verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("researcher_identities_provider_unique").on(table.provider, table.externalId),
  index("researcher_identities_researcher_idx").on(table.researcherId),
]);

export const researcherSources = sqliteTable("researcher_sources", {
  researcherId: text("researcher_id").notNull().references(() => researchers.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  relation: text("relation", { enum: ["official_profile", "lab", "cv", "publications"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("researcher_sources_relation_unique").on(table.researcherId, table.sourceId, table.relation),
  index("researcher_sources_source_idx").on(table.sourceId),
]);

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  doi: text("doi"),
  pmid: text("pmid"),
  arxivId: text("arxiv_id"),
  title: text("title").notNull(),
  abstract: text("abstract").notNull().default(""),
  venue: text("venue").notNull().default(""),
  publicationDate: text("publication_date"),
  paperType: text("paper_type", { enum: ["journal", "conference", "preprint", "review", "other"] }).notNull().default("other"),
  versionStatus: text("version_status", { enum: ["published", "preprint", "corrected", "retracted"] }).notNull().default("published"),
  openAccessUrl: text("open_access_url"),
  sourceUrl: text("source_url").notNull(),
  sourceProvider: text("source_provider", { enum: ["official", "crossref", "europe_pmc", "arxiv", "manual"] }).notNull().default("official"),
  topicsJson: text("topics_json").notNull().default("[]"),
  takeaway: text("takeaway").notNull().default(""),
  relevanceScore: integer("relevance_score").notNull().default(0),
  reviewStatus: text("review_status", { enum: ["verified", "candidate", "rejected"] }).notNull().default("candidate"),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("papers_doi_unique").on(table.doi),
  uniqueIndex("papers_pmid_unique").on(table.pmid),
  uniqueIndex("papers_arxiv_unique").on(table.arxivId),
  index("papers_published_date_idx").on(table.published, table.publicationDate),
  index("papers_review_idx").on(table.reviewStatus, table.createdAt),
]);

export const paperAuthors = sqliteTable("paper_authors", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  researcherId: text("researcher_id").references(() => researchers.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  authorOrder: integer("author_order").notNull().default(0),
  corresponding: integer("corresponding", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (table) => [
  uniqueIndex("paper_authors_order_unique").on(table.paperId, table.authorOrder),
  index("paper_authors_researcher_idx").on(table.researcherId, table.paperId),
]);

export const academicSyncRuns = sqliteTable("academic_sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["cron", "manual", "test"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  researchersChecked: integer("researchers_checked").notNull().default(0),
  candidatesFound: integer("candidates_found").notNull().default(0),
  papersInserted: integer("papers_inserted").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("academic_sync_runs_started_idx").on(table.startedAt),
]);

export const academicEvents = sqliteTable("academic_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => academicSyncRuns.id, { onDelete: "set null" }),
  researcherId: text("researcher_id").references(() => researchers.id, { onDelete: "set null" }),
  paperId: text("paper_id").references(() => papers.id, { onDelete: "set null" }),
  eventType: text("event_type", { enum: ["profile_checked", "paper_candidate", "paper_updated", "sync_failed"] }).notNull(),
  confidence: integer("confidence").notNull().default(0),
  message: text("message").notNull().default(""),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("academic_events_created_idx").on(table.createdAt),
  index("academic_events_researcher_idx").on(table.researcherId, table.createdAt),
]);

export const paperProviders = sqliteTable("paper_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category", { enum: ["metadata", "biomedical", "preprint", "identity", "citation", "fulltext"] }).notNull(),
  homepageUrl: text("homepage_url").notNull(),
  apiDocsUrl: text("api_docs_url").notNull(),
  description: text("description").notNull(),
  coverage: text("coverage").notNull(),
  authMode: text("auth_mode", { enum: ["none", "api_key", "oauth", "paid"] }).notNull().default("none"),
  credentialEnv: text("credential_env"),
  status: text("status", { enum: ["active", "available", "requires_config", "planned", "blocked"] }).notNull().default("planned"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  discoveryEnabled: integer("discovery_enabled", { mode: "boolean" }).notNull().default(false),
  priority: integer("priority").notNull().default(100),
  capabilitiesJson: text("capabilities_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  lastSyncAt: text("last_sync_at"),
  lastSyncStatus: text("last_sync_status", { enum: ["succeeded", "partial", "failed"] }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  index("paper_providers_status_idx").on(table.status, table.priority),
  index("paper_providers_enabled_idx").on(table.enabled, table.discoveryEnabled),
]);

export const paperProviderSyncLogs = sqliteTable("paper_provider_sync_logs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => academicSyncRuns.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull().references(() => paperProviders.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  researchersChecked: integer("researchers_checked").notNull().default(0),
  candidatesFound: integer("candidates_found").notNull().default(0),
  papersInserted: integer("papers_inserted").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("paper_provider_sync_run_unique").on(table.runId, table.providerId),
  index("paper_provider_sync_provider_idx").on(table.providerId, table.startedAt),
]);

export const paperProviderRecords = sqliteTable("paper_provider_records", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull().references(() => paperProviders.id, { onDelete: "cascade" }),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  metadataHash: text("metadata_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("paper_provider_records_external_unique").on(table.providerId, table.externalId),
  uniqueIndex("paper_provider_records_paper_unique").on(table.providerId, table.paperId),
  index("paper_provider_records_paper_idx").on(table.paperId),
]);
