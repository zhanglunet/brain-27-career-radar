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
  deadlineAt: text("deadline_at"),
  opensAt: text("opens_at"),
  deadlineTimezone: text("deadline_timezone").notNull().default("Asia/Shanghai"),
  deadlineStatus: text("deadline_status", { enum: ["confirmed", "estimated", "rolling", "unknown", "closed"] }).notNull().default("unknown"),
  nextActionAt: text("next_action_at"),
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
  nameEn: text("name_en"),
  institutionType: text("institution_type", { enum: ["university", "national_lab", "cas_institute", "research_institute", "company"] }).notNull().default("research_institute"),
  city: text("city").notNull().default(""),
  topicsJson: text("topics_json").notNull().default("[]"),
  mark: text("mark").notNull(),
  summary: text("summary").notNull(),
  note: text("note").notNull(),
  url: text("url").notNull(),
  opportunityUrl: text("opportunity_url"),
  priority: text("priority", { enum: ["normal", "high", "critical"] }).notNull().default("normal"),
  sortOrder: integer("sort_order").notNull().default(0),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  index("institutions_published_idx").on(table.published, table.sortOrder),
  index("institutions_source_idx").on(table.sourceId),
  index("institutions_city_type_idx").on(table.city, table.institutionType, table.priority),
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

export const intelligenceReports = sqliteTable("intelligence_reports", {
  id: text("id").primaryKey(),
  periodType: text("period_type", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  newOpportunities: integer("new_opportunities").notNull().default(0),
  newSources: integer("new_sources").notNull().default(0),
  newPapers: integer("new_papers").notNull().default(0),
  newPolicies: integer("new_policies").notNull().default(0),
  newProjects: integer("new_projects").notNull().default(0),
  sourceChanges: integer("source_changes").notNull().default(0),
  sourceFailures: integer("source_failures").notNull().default(0),
  sourceRuns: integer("source_runs").notNull().default(0),
  academicRuns: integer("academic_runs").notNull().default(0),
  policyRuns: integer("policy_runs").notNull().default(0),
  summary: text("summary").notNull(),
  highlightsJson: text("highlights_json").notNull().default('{"opportunities":[],"sources":[],"papers":[],"policies":[],"projects":[]}'),
  generatedAt: text("generated_at").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("intelligence_reports_period_unique").on(table.periodType, table.periodStart),
  index("intelligence_reports_history_idx").on(table.periodType, table.periodStart),
]);

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
  pmcid: text("pmcid"),
  arxivId: text("arxiv_id"),
  title: text("title").notNull(),
  titleZh: text("title_zh"),
  abstract: text("abstract").notNull().default(""),
  abstractZh: text("abstract_zh"),
  translationStatus: text("translation_status", { enum: ["pending", "completed", "failed", "not_needed"] }).notNull().default("pending"),
  translatedAt: text("translated_at"),
  translationError: text("translation_error"),
  venue: text("venue").notNull().default(""),
  publicationDate: text("publication_date"),
  paperType: text("paper_type", { enum: ["journal", "conference", "preprint", "review", "other"] }).notNull().default("other"),
  versionStatus: text("version_status", { enum: ["published", "preprint", "corrected", "retracted"] }).notNull().default("published"),
  openAccessUrl: text("open_access_url"),
  sourceUrl: text("source_url").notNull(),
  sourceProvider: text("source_provider", { enum: ["official", "crossref", "europe_pmc", "arxiv", "pubmed", "pmc", "doaj", "manual"] }).notNull().default("official"),
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
  uniqueIndex("papers_pmcid_unique").on(table.pmcid),
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

export const organizationDiscoveryFeeds = sqliteTable("organization_discovery_feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  region: text("region").notNull(),
  candidateType: text("candidate_type", { enum: ["company", "research", "mixed"] }).notNull().default("mixed"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  checkIntervalHours: integer("check_interval_hours").notNull().default(24),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  lastStatusCode: integer("last_status_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("organization_discovery_feeds_url_unique").on(table.url),
  index("organization_discovery_feeds_enabled_idx").on(table.enabled, table.lastCheckedAt),
]);

export const organizationCandidates = sqliteTable("organization_candidates", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").notNull().references(() => organizationDiscoveryFeeds.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  candidateUrl: text("candidate_url").notNull(),
  canonicalHost: text("canonical_host").notNull(),
  candidateType: text("candidate_type", { enum: ["company", "research", "mixed"] }).notNull().default("mixed"),
  region: text("region").notNull(),
  status: text("status", { enum: ["candidate", "approved", "rejected"] }).notNull().default("candidate"),
  confidence: integer("confidence").notNull().default(60),
  evidenceExcerpt: text("evidence_excerpt").notNull().default(""),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("organization_candidates_url_unique").on(table.candidateUrl),
  index("organization_candidates_status_idx").on(table.status, table.lastSeenAt),
  index("organization_candidates_feed_idx").on(table.feedId, table.lastSeenAt),
]);

export const organizationDiscoveryRuns = sqliteTable("organization_discovery_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["cron", "manual", "test"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  feedsChecked: integer("feeds_checked").notNull().default(0),
  candidatesFound: integer("candidates_found").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("organization_discovery_runs_started_idx").on(table.startedAt)]);

export const policyFeeds = sqliteTable("policy_feeds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  authority: text("authority").notNull(),
  region: text("region", { enum: ["UK", "EU", "CN", "HK", "GLOBAL"] }).notNull(),
  url: text("url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  checkIntervalHours: integer("check_interval_hours").notNull().default(24),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessAt: text("last_success_at"),
  lastStatusCode: integer("last_status_code"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("policy_feeds_url_unique").on(table.url),
  index("policy_feeds_enabled_idx").on(table.enabled, table.lastCheckedAt),
]);

export const researchPolicies = sqliteTable("research_policies", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").references(() => policyFeeds.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  titleEn: text("title_en"),
  authority: text("authority").notNull(),
  region: text("region", { enum: ["UK", "EU", "CN", "HK", "GLOBAL"] }).notNull(),
  policyType: text("policy_type", { enum: ["strategy", "funding", "talent", "regulation", "collaboration", "programme"] }).notNull(),
  status: text("status", { enum: ["open", "active", "upcoming", "closed", "watch"] }).notNull().default("watch"),
  publishedAt: text("published_at"),
  effectiveAt: text("effective_at"),
  deadlineAt: text("deadline_at"),
  deadlineTimezone: text("deadline_timezone").notNull().default("UTC"),
  summary: text("summary").notNull(),
  impact: text("impact").notNull().default(""),
  audienceJson: text("audience_json").notNull().default("[]"),
  topicsJson: text("topics_json").notNull().default("[]"),
  sourceUrl: text("source_url").notNull(),
  contentHash: text("content_hash"),
  reviewStatus: text("review_status", { enum: ["verified", "candidate", "rejected"] }).notNull().default("candidate"),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("research_policies_url_unique").on(table.sourceUrl),
  index("research_policies_public_idx").on(table.published, table.region, table.status),
  index("research_policies_deadline_idx").on(table.deadlineAt),
]);

export const policyVersions = sqliteTable("policy_versions", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull().references(() => researchPolicies.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  capturedAt: text("captured_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("policy_versions_hash_unique").on(table.policyId, table.contentHash),
  index("policy_versions_policy_idx").on(table.policyId, table.capturedAt),
]);

export const policyCandidates = sqliteTable("policy_candidates", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").notNull().references(() => policyFeeds.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  candidateUrl: text("candidate_url").notNull(),
  region: text("region").notNull(),
  policyType: text("policy_type").notNull().default("programme"),
  status: text("status", { enum: ["candidate", "approved", "rejected"] }).notNull().default("candidate"),
  confidence: integer("confidence").notNull().default(60),
  evidenceExcerpt: text("evidence_excerpt").notNull().default(""),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("policy_candidates_url_unique").on(table.candidateUrl),
  index("policy_candidates_status_idx").on(table.status, table.lastSeenAt),
]);

export const policySyncRuns = sqliteTable("policy_sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["cron", "manual", "test"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  feedsChecked: integer("feeds_checked").notNull().default(0),
  policiesChecked: integer("policies_checked").notNull().default(0),
  candidatesFound: integer("candidates_found").notNull().default(0),
  versionsAdded: integer("versions_added").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("policy_sync_runs_started_idx").on(table.startedAt)]);

export const researchProjects = sqliteTable("research_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  leadOrganization: text("lead_organization").notNull(),
  region: text("region").notNull(),
  status: text("status", { enum: ["active", "upcoming", "completed", "watch"] }).notNull().default("watch"),
  startAt: text("start_at"),
  endAt: text("end_at"),
  funding: text("funding").notNull().default(""),
  summary: text("summary").notNull(),
  opportunityValue: text("opportunity_value").notNull().default(""),
  topicsJson: text("topics_json").notNull().default("[]"),
  url: text("url").notNull(),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  sourceVerifiedAt: text("source_verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("research_projects_url_unique").on(table.url),
  index("research_projects_public_idx").on(table.published, table.region, table.status),
]);

export const researchTopics = sqliteTable("research_topics", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  category: text("category").notNull(),
  momentum: text("momentum", { enum: ["rising", "stable", "watch"] }).notNull().default("watch"),
  summary: text("summary").notNull(),
  evidence: text("evidence").notNull(),
  policyCount: integer("policy_count").notNull().default(0),
  projectCount: integer("project_count").notNull().default(0),
  paperCount: integer("paper_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("research_topics_name_unique").on(table.name)]);

export const academicConferences = sqliteTable("academic_conferences", {
  id: text("id").primaryKey(),
  series: text("series").notNull(),
  name: text("name").notNull(),
  nameZh: text("name_zh").notNull(),
  field: text("field", { enum: ["psychology", "neuroscience", "ai", "interdisciplinary"] }).notNull(),
  conferenceType: text("conference_type", { enum: ["peer_reviewed", "abstract_meeting", "hybrid"] }).notNull(),
  year: integer("year").notNull(),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default(""),
  venue: text("venue").notNull().default(""),
  status: text("status", { enum: ["open", "upcoming", "in_progress", "completed", "watch"] }).notNull().default("watch"),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  dateStatus: text("date_status", { enum: ["confirmed", "month_confirmed", "tba"] }).notNull().default("tba"),
  summary: text("summary").notNull(),
  relevance: text("relevance").notNull().default(""),
  topicsJson: text("topics_json").notNull().default("[]"),
  officialUrl: text("official_url").notNull(),
  cfpUrl: text("cfp_url"),
  proceedingsUrl: text("proceedings_url"),
  contentHash: text("content_hash"),
  checkIntervalHours: integer("check_interval_hours").notNull().default(24),
  sourceVerifiedAt: text("source_verified_at"),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("academic_conferences_url_unique").on(table.officialUrl),
  index("academic_conferences_public_idx").on(table.published, table.field, table.year, table.status),
  index("academic_conferences_date_idx").on(table.startsAt),
]);

export const conferenceDates = sqliteTable("conference_dates", {
  id: text("id").primaryKey(),
  conferenceId: text("conference_id").notNull().references(() => academicConferences.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["abstract_deadline", "paper_deadline", "supplementary_deadline", "notification", "camera_ready", "late_breaking", "registration", "workshop_proposal", "commitment", "response", "other"] }).notNull(),
  label: text("label").notNull(),
  occursAt: text("occurs_at"),
  endsAt: text("ends_at"),
  timezone: text("timezone").notNull().default("UTC"),
  dateStatus: text("date_status", { enum: ["confirmed", "month_confirmed", "tba"] }).notNull().default("tba"),
  actionRequired: integer("action_required", { mode: "boolean" }).notNull().default(false),
  officialUrl: text("official_url").notNull(),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("conference_dates_conference_idx").on(table.conferenceId, table.occursAt),
  index("conference_dates_calendar_idx").on(table.occursAt, table.eventType),
]);

export const conferenceVersions = sqliteTable("conference_versions", {
  id: text("id").primaryKey(),
  conferenceId: text("conference_id").notNull().references(() => academicConferences.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  capturedAt: text("captured_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("conference_versions_hash_unique").on(table.conferenceId, table.contentHash),
  index("conference_versions_conference_idx").on(table.conferenceId, table.capturedAt),
]);

export const conferenceSyncRuns = sqliteTable("conference_sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger", { enum: ["cron", "manual", "test"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  conferencesChecked: integer("conferences_checked").notNull().default(0),
  versionsAdded: integer("versions_added").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("conference_sync_runs_started_idx").on(table.startedAt)]);
