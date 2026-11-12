import assert from "node:assert/strict";
import test from "node:test";
import { applyPlatformMigrations, createSqliteD1, tempDbPath } from "./helpers/sqlite-d1.mjs";
import {
  clearLoginFailures,
  consumeInvite,
  consumeResetToken,
  countActiveAdmins,
  createInvite,
  createResetToken,
  createUser,
  deleteUserRow,
  findUserByEmail,
  isLoginLocked,
  recordLoginFailure,
  setUserStatus,
} from "../platform/data/accounts.ts";
import { createSession, findSessionUser, revokeSession, revokeUserSessions } from "../platform/data/sessions.ts";
import { hasConsent, recordConsent } from "../platform/data/consents.ts";
import { forUser } from "../platform/data/scoped.ts";
import { USER_TABLES } from "../platform/data/tables.ts";
import { listPublicOpportunities } from "../platform/data/public-readonly.ts";

const DAY = 86_400_000;
const MINUTE = 60_000;

async function freshDb() {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  return db;
}

function mkUser(db, email, role = "user", status = "active") {
  return createUser(db, { email, passwordHash: "pbkdf2$x", role, status }, 0);
}

test("forUser 之间互不可见", async () => {
  const db = await freshDb();
  const a = await mkUser(db, "a@example.test");
  const b = await mkUser(db, "b@example.test");
  const goal = await forUser(db, a.id).goals.create({ title: "国内校招", description: "互联网产品岗" }, 1);
  assert.equal((await forUser(db, b.id).goals.list()).length, 0);
  assert.equal(await forUser(db, b.id).goals.remove(goal.id), false);
  assert.equal((await forUser(db, a.id).goals.list()).length, 1);
  assert.equal(await forUser(db, a.id).goals.remove(goal.id), true);
  assert.equal((await forUser(db, a.id).goals.list()).length, 0);
});

test("createUser 规范化邮箱并拒绝重复", async () => {
  const db = await freshDb();
  const user = await mkUser(db, "  A@Example.TEST ");
  assert.equal(user.email, "a@example.test");
  await assert.rejects(() => mkUser(db, "a@example.test"), (error) => error.status === 409);
  assert.equal((await findUserByEmail(db, "A@EXAMPLE.test")).id, user.id);
});

test("邀请码只能成功使用一次且过期失效", async () => {
  const db = await freshDb();
  const admin = await mkUser(db, "admin@example.test", "admin");
  const code = await createInvite(db, admin.id, 0);
  assert.equal(await consumeInvite(db, code, "u1", 1), true);
  assert.equal(await consumeInvite(db, code, "u2", 2), false);
  const late = await createInvite(db, admin.id, 0);
  assert.equal(await consumeInvite(db, late, "u3", 7 * DAY + 1), false);
  assert.equal(await consumeInvite(db, "not-a-code", "u4", 1), false);
});

test("邀请码只存哈希", async () => {
  const db = await freshDb();
  const admin = await mkUser(db, "admin@example.test", "admin");
  const code = await createInvite(db, admin.id, 0);
  const { results } = await db.prepare("SELECT code_hash FROM invites").all();
  assert.notEqual(results[0].code_hash, code);
});

test("重置令牌一次有效、24 小时过期", async () => {
  const db = await freshDb();
  const admin = await mkUser(db, "admin@example.test", "admin");
  const user = await mkUser(db, "u@example.test");
  const token = await createResetToken(db, user.id, admin.id, 0);
  assert.equal(await consumeResetToken(db, token, 1), user.id);
  assert.equal(await consumeResetToken(db, token, 2), null);
  const late = await createResetToken(db, user.id, admin.id, 0);
  assert.equal(await consumeResetToken(db, late, DAY + 1), null);
});

test("会话：有效、撤销、过期、停用即失效", async () => {
  const db = await freshDb();
  const user = await mkUser(db, "c@example.test");
  const token = await createSession(db, user.id, 0);
  assert.equal((await findSessionUser(db, token, 1)).id, user.id);
  assert.equal(await findSessionUser(db, token, 30 * DAY + 1), null);
  await setUserStatus(db, user.id, "disabled", 2);
  assert.equal(await findSessionUser(db, token, 3), null);
  await setUserStatus(db, user.id, "active", 4);
  const second = await createSession(db, user.id, 5);
  await revokeSession(db, second, 6);
  assert.equal(await findSessionUser(db, second, 7), null);
  const third = await createSession(db, user.id, 8);
  await revokeUserSessions(db, user.id, 9);
  assert.equal(await findSessionUser(db, third, 10), null);
});

test("会话只存令牌哈希", async () => {
  const db = await freshDb();
  const user = await mkUser(db, "h@example.test");
  const token = await createSession(db, user.id, 0);
  const { results } = await db.prepare("SELECT token_hash FROM sessions").all();
  assert.notEqual(results[0].token_hash, token);
});

test("登录失败 5 次锁定 15 分钟", async () => {
  const db = await freshDb();
  const email = "lock@example.test";
  for (let i = 0; i < 4; i += 1) await recordLoginFailure(db, email, i);
  assert.equal(await isLoginLocked(db, email, 10), false);
  await recordLoginFailure(db, email, 5);
  assert.equal(await isLoginLocked(db, email, 10), true);
  assert.equal(await isLoginLocked(db, email, 5 + 15 * MINUTE + 1), false);
  await clearLoginFailures(db, email);
  assert.equal(await isLoginLocked(db, email, 10), false);
});

test("同意记录", async () => {
  const db = await freshDb();
  const user = await mkUser(db, "consent@example.test");
  assert.equal(await hasConsent(db, user.id, "v1"), false);
  await recordConsent(db, user.id, "v1", 1);
  await recordConsent(db, user.id, "v1", 2);
  assert.equal(await hasConsent(db, user.id, "v1"), true);
  assert.equal(await hasConsent(db, user.id, "v2"), false);
});

test("countActiveAdmins 只计 active 管理员", async () => {
  const db = await freshDb();
  await mkUser(db, "a1@example.test", "admin");
  const second = await mkUser(db, "a2@example.test", "admin");
  await mkUser(db, "u@example.test");
  assert.equal(await countActiveAdmins(db), 2);
  await setUserStatus(db, second.id, "disabled", 1);
  assert.equal(await countActiveAdmins(db), 1);
});

test("deleteAll 清空该用户所有 USER_TABLES 行且不动他人", async () => {
  const db = await freshDb();
  const admin = await mkUser(db, "admin@example.test", "admin");
  const a = await mkUser(db, "a@example.test");
  const b = await mkUser(db, "b@example.test");
  for (const user of [a, b]) {
    await forUser(db, user.id).goals.create({ title: "t", description: "d" }, 1);
    await recordConsent(db, user.id, "v1", 1);
    await createSession(db, user.id, 1);
    await createResetToken(db, user.id, admin.id, 1);
  }
  await forUser(db, a.id).deleteAll();
  for (const table of USER_TABLES) {
    const countFor = async (id) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(id).first()).n;
    assert.equal(await countFor(a.id), 0, table);
    assert.equal(await countFor(b.id), 1, table);
  }
  assert.equal(await db.prepare("SELECT id FROM users WHERE id = ?").bind(a.id).first(), null);
  assert.ok(await db.prepare("SELECT id FROM users WHERE id = ?").bind(b.id).first());
});

test("exportAll 只含本人数据且无密码哈希", async () => {
  const db = await freshDb();
  const a = await mkUser(db, "a@example.test");
  const b = await mkUser(db, "b@example.test");
  await forUser(db, a.id).goals.create({ title: "A 目标", description: "d" }, 1);
  await forUser(db, b.id).goals.create({ title: "B 目标", description: "d" }, 1);
  await recordConsent(db, a.id, "v1", 2);
  const exported = await forUser(db, a.id).exportAll(3);
  assert.equal(exported.user.email, "a@example.test");
  assert.deepEqual(exported.goals.map((goal) => goal.title), ["A 目标"]);
  assert.deepEqual(exported.consents, [{ version: "v1", acceptedAt: 2 }]);
  assert.equal(exported.exportedAt, 3);
  assert.ok(!JSON.stringify(exported).includes("pbkdf2"));
});

test("deleteUserRow 只删 pending 用户", async () => {
  const db = await freshDb();
  const pending = await mkUser(db, "p@example.test", "user", "pending");
  const active = await mkUser(db, "act@example.test");
  await deleteUserRow(db, pending.id);
  await deleteUserRow(db, active.id);
  assert.equal(await db.prepare("SELECT id FROM users WHERE id = ?").bind(pending.id).first(), null);
  assert.ok(await db.prepare("SELECT id FROM users WHERE id = ?").bind(active.id).first());
});

test("公开只读模块从只读库读取并夹紧 limit", async () => {
  const path = tempDbPath();
  const writable = createSqliteD1({ path });
  await writable.exec(`CREATE TABLE opportunities (id TEXT PRIMARY KEY, name TEXT, org TEXT, kind TEXT, location TEXT, deadline TEXT, url TEXT, published INTEGER);`);
  for (let i = 0; i < 120; i += 1) {
    await writable
      .prepare("INSERT INTO opportunities VALUES (?, 'n', 'o', 'k', 'l', 'd', 'https://example.test', ?)")
      .bind(`opp-${String(i).padStart(3, "0")}`, i === 0 ? 0 : 1)
      .run();
  }
  const publicDb = createSqliteD1({ readonly: true, path });
  const rows = await listPublicOpportunities(publicDb, 500);
  assert.equal(rows.length, 100);
  assert.ok(!rows.some((row) => row.id === "opp-000"));
  assert.equal((await listPublicOpportunities(publicDb, 0)).length, 1);
});
