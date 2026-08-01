import assert from "node:assert/strict";
import test from "node:test";
import { monitorSources } from "../lib/source-monitor.ts";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    if (!this.sql.includes("FROM sources")) throw new Error(`Unexpected all(): ${this.sql}`);
    return { results: this.database.sources.map((source) => ({ ...source })) };
  }

  async first() {
    if (this.sql.includes("FROM source_snapshots")) return { id: "snapshot-1" };
    throw new Error(`Unexpected first(): ${this.sql}`);
  }

  async run() {
    this.database.operations.push({ sql: this.sql, params: this.params });
    return { success: true };
  }
}

class FakeDatabase {
  constructor(source) {
    this.sources = [source];
    this.operations = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function source(overrides = {}) {
  return {
    id: "official-source",
    name: "Official source",
    url: "https://example.test/jobs",
    etag: null,
    last_modified: null,
    content_hash: null,
    final_url: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

test("monitor stores a baseline snapshot without creating a review item", async () => {
  const database = new FakeDatabase(source());
  const result = await monitorSources(database, {
    trigger: "test",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    fetcher: async () => new Response("<main>official opportunity</main>", {
      status: 200,
      headers: { etag: '"v1"' },
    }),
  });

  assert.deepEqual(result, {
    runId: result.runId,
    status: "succeeded",
    checkedCount: 1,
    changedCount: 0,
    failedCount: 0,
  });
  assert.ok(database.operations.some((operation) => operation.sql.startsWith("INSERT INTO source_snapshots")));
  assert.equal(database.operations.some((operation) => operation.sql.startsWith("INSERT INTO review_queue")), false);
  const checkLog = database.operations.find((operation) => operation.sql.startsWith("INSERT INTO source_check_logs"));
  assert.equal(checkLog?.params[4], "unchanged");
  assert.equal(checkLog?.params[5], 1);
});

test("monitor queues a review when known source content changes", async () => {
  const database = new FakeDatabase(source({ content_hash: "old-hash" }));
  const result = await monitorSources(database, {
    trigger: "test",
    fetcher: async () => new Response("changed official content", { status: 200 }),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.changedCount, 1);
  const review = database.operations.find((operation) => operation.sql.startsWith("INSERT INTO review_queue"));
  assert.equal(review?.params[3], "content_changed");
});

test("304 response refreshes verification without creating a duplicate snapshot", async () => {
  const database = new FakeDatabase(source({
    content_hash: "known-hash",
    etag: '"v1"',
    final_url: "https://example.test/jobs",
  }));
  const result = await monitorSources(database, {
    trigger: "test",
    fetcher: async () => new Response(null, { status: 304 }),
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.changedCount, 0);
  assert.equal(database.operations.some((operation) => operation.sql.startsWith("INSERT INTO source_snapshots")), false);
  assert.ok(database.operations.some((operation) => operation.sql.startsWith("UPDATE opportunities SET source_verified_at")));
  const checkLog = database.operations.find((operation) => operation.sql.startsWith("INSERT INTO source_check_logs"));
  assert.equal(checkLog?.params[4], "not_modified");
  assert.equal(checkLog?.params[7], 304);
});

test("third consecutive source failure is retained and sent to review", async () => {
  const database = new FakeDatabase(source({
    content_hash: "last-trusted-hash",
    consecutive_failures: 2,
  }));
  const result = await monitorSources(database, {
    trigger: "test",
    fetcher: async () => new Response("Unavailable", { status: 503 }),
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failedCount, 1);
  assert.equal(database.operations.some((operation) => operation.sql.startsWith("INSERT INTO source_snapshots")), false);
  const review = database.operations.find((operation) => operation.sql.startsWith("INSERT INTO review_queue"));
  assert.equal(review?.params[3], "repeated_failure");
  assert.match(String(review?.params[4]), /"consecutiveFailures":3/);
  const checkLog = database.operations.find((operation) => operation.sql.startsWith("INSERT INTO source_check_logs"));
  assert.equal(checkLog?.params[4], "failed");
  assert.equal(checkLog?.params[7], 503);
  assert.match(String(checkLog?.params[9]), /HTTP 503/);
});
