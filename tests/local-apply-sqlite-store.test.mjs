import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AI_DRAFT_MARKER,
  createSqliteDraftStore,
  defaultDbPath,
} from "../lib/local-apply/sqlite-store.ts";
import { createDraftStore as createMemoryStore } from "../lib/local-apply/drafter.ts";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "brain27-sqlite-test-"));
  return { dir, path: join(dir, "brain27.db") };
}

const FIXED_NOW = () => new Date("2026-10-19T12:00:00.000Z");

test("save/get/list 往返：字段完整", () => {
  const { dir, path } = tempDb();
  const store = createSqliteDraftStore({ path, now: FIXED_NOW });
  try {
    const saved = store.save("cv", "opp-oxford-ra", "简历内容 v1");
    assert.equal(saved.id, "cv:opp-oxford-ra:v1");
    assert.equal(saved.version, 1);
    assert.equal(saved.createdAt, "2026-10-19T12:00:00.000Z");
    assert.equal(saved.marker, AI_DRAFT_MARKER);
    assert.equal(saved.content, "简历内容 v1");

    const got = store.get("cv", "opp-oxford-ra");
    assert.deepEqual(got, saved);

    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], saved);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("版本自动递增：v1→v2；get 取最新/指定版本", () => {
  const { dir, path } = tempDb();
  const store = createSqliteDraftStore({ path, now: FIXED_NOW });
  try {
    store.save("ps", "opp-cambridge-ra", "PS v1");
    const v2 = store.save("ps", "opp-cambridge-ra", "PS v2");
    assert.equal(v2.version, 2);
    assert.equal(v2.id, "ps:opp-cambridge-ra:v2");

    // 不同 kind / 不同机会互不干扰
    const other = store.save("cv", "opp-cambridge-ra", "CV v1");
    assert.equal(other.version, 1);

    const latest = store.get("ps", "opp-cambridge-ra");
    assert.equal(latest.version, 2);
    assert.equal(latest.content, "PS v2");

    const first = store.get("ps", "opp-cambridge-ra", 1);
    assert.equal(first.content, "PS v1");

    assert.equal(store.get("email", "opp-cambridge-ra"), undefined);
    assert.equal(store.get("ps", "opp-cambridge-ra", 99), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list 按 opportunityId 过滤", () => {
  const { dir, path } = tempDb();
  const store = createSqliteDraftStore({ path, now: FIXED_NOW });
  try {
    store.save("cv", "opp-a", "a");
    store.save("ps", "opp-b", "b");
    store.save("email", "opp-a", "c");
    assert.equal(store.list("opp-a").length, 2);
    assert.equal(store.list("opp-b").length, 1);
    assert.equal(store.list("opp-none").length, 0);
    assert.equal(store.list().length, 3);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("落盘：关闭重开后数据仍在（持久化）", () => {
  const { dir, path } = tempDb();
  const s1 = createSqliteDraftStore({ path, now: FIXED_NOW });
  s1.save("cv", "opp-x", "第一版");
  s1.save("cv", "opp-x", "第二版");
  s1.close();

  const s2 = createSqliteDraftStore({ path, now: FIXED_NOW });
  try {
    const latest = s2.get("cv", "opp-x");
    assert.equal(latest.version, 2);
    assert.equal(latest.content, "第二版");
    // 重开后版本号继续递增，不是从 1 重来
    const v3 = s2.save("cv", "opp-x", "第三版");
    assert.equal(v3.version, 3);
  } finally {
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("数据库文件权限 0600（仅属主可读写）", () => {
  const { dir, path } = tempDb();
  const store = createSqliteDraftStore({ path, now: FIXED_NOW });
  try {
    store.save("cv", "opp-x", "x");
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600, `期望 0600，实际 ${mode.toString(8)}`);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("defaultDbPath：默认 ~/.brain27/brain27.db，BRAIN27_HOME 可覆盖", () => {
  const def = defaultDbPath();
  assert.ok(def.endsWith(join(".brain27", "brain27.db")), def);

  const prev = process.env.BRAIN27_HOME;
  process.env.BRAIN27_HOME = "/tmp/custom-home-test";
  try {
    assert.equal(defaultDbPath(), join("/tmp/custom-home-test", "brain27.db"));
  } finally {
    if (prev === undefined) delete process.env.BRAIN27_HOME;
    else process.env.BRAIN27_HOME = prev;
  }
});

test("接口兼容：同一场景下 SQLite 版与内存版结果一致", () => {
  const { dir, path } = tempDb();
  const sqlite = createSqliteDraftStore({ path, now: FIXED_NOW });
  const memory = createMemoryStore(FIXED_NOW);
  try {
    const scenario = (store) => {
      store.save("cv", "opp-1", "cv 内容");
      store.save("ps", "opp-1", "ps v1");
      store.save("ps", "opp-1", "ps v2");
      store.save("email", "opp-2", "邮件");
      return {
        latest: store.get("ps", "opp-1"),
        v1: store.get("ps", "opp-1", 1),
        byOpp: store.list("opp-1").map((d) => d.id),
        all: store.list().map((d) => d.id),
        missing: store.get("cv", "opp-2"),
      };
    };
    assert.deepEqual(scenario(sqlite), scenario(memory));
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("数据主权：sqlite-store.ts 不含任何网络调用", () => {
  const src = readFileSync(
    new URL("../lib/local-apply/sqlite-store.ts", import.meta.url),
    "utf-8",
  );
  const codeLines = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
  const code = codeLines.join("\n");
  for (const pat of ["fetch(", "XMLHttpRequest", "WebSocket(", "node:http", "https.request"]) {
    assert.ok(!code.includes(pat), `源码不应包含 ${pat}`);
  }
});
