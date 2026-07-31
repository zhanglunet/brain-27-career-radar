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
]);

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  org: text("org").notNull(),
  kind: text("kind", { enum: ["博士", "联培博士", "校招", "实习", "研究岗位"] }).notNull(),
  status: text("status", { enum: ["立即行动", "等待开放", "持续关注"] }).notNull(),
  fit: text("fit", { enum: ["高度匹配", "匹配", "转型匹配"] }).notNull(),
  location: text("location").notNull(),
  deadline: text("deadline").notNull(),
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

export const reviewQueue = sqliteTable("review_queue", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "set null" }),
  runId: text("run_id").references(() => syncRuns.id, { onDelete: "set null" }),
  reason: text("reason", { enum: ["content_changed", "repeated_failure", "new_source", "parse_conflict"] }).notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  index("review_queue_status_idx").on(table.status, table.createdAt),
]);
