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
