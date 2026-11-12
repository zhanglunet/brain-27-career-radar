import assert from "node:assert/strict";
import test from "node:test";
import { applyPlatformMigrations, createSqliteD1, tempDbPath } from "./helpers/sqlite-d1.mjs";

const TABLES = ["users", "invites", "sessions", "consents", "password_resets", "login_attempts", "goals", "audit_log"];

test("迁移创建全部私有表", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = results.map((row) => row.name);
  for (const table of TABLES) assert.ok(names.includes(table), table);
});

test("role 与 status 有 CHECK 约束", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const insert = (role, status) => db
    .prepare("INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, 'h', ?, ?, 0)")
    .bind(`${role}-${status}`, `${role}-${status}@example.test`, role, status)
    .run();
  await insert("user", "pending");
  await assert.rejects(() => insert("root", "active"));
  await assert.rejects(() => insert("user", "banned"));
});

test("邮箱唯一", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const insert = (id) => db
    .prepare("INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, 'same@example.test', 'h', 'user', 'pending', 0)")
    .bind(id)
    .run();
  await insert("a");
  await assert.rejects(() => insert("b"));
});

test("first 无行返回 null，run 返回 changes", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  assert.equal(await db.prepare("SELECT * FROM users WHERE id = ?").bind("none").first(), null);
  const result = await db
    .prepare("INSERT INTO login_attempts (email, attempted_at) VALUES (?, ?)")
    .bind("x@example.test", 1)
    .run();
  assert.equal(result.meta.changes, 1);
});

test("batch 在一个事务里执行", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const ok = db.prepare("INSERT INTO login_attempts (email, attempted_at) VALUES ('a@example.test', 1)");
  const bad = db.prepare("INSERT INTO no_such_table VALUES (1)");
  await assert.rejects(() => db.batch([ok, bad]));
  const { results } = await db.prepare("SELECT * FROM login_attempts").all();
  assert.equal(results.length, 0);
});

test("readonly 替身拒绝写入", async () => {
  const path = tempDbPath();
  const writable = createSqliteD1({ path });
  await writable.prepare("CREATE TABLE t (a)").run();
  const db = createSqliteD1({ readonly: true, path });
  await assert.rejects(() => db.prepare("INSERT INTO t VALUES (1)").run());
  await assert.rejects(() => db.prepare("CREATE TABLE x (a)").run());
});
