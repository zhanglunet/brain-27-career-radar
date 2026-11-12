import assert from "node:assert/strict";
import test from "node:test";
import { CONSENT_VERSION } from "../platform/consent.ts";
import { activeUser, makeEnv } from "./helpers/platform-client.mjs";
import { createFakeR2 } from "./helpers/fake-r2.mjs";
import { findUserByEmail } from "../platform/data/accounts.ts";
import { USER_TABLES } from "../platform/data/tables.ts";

async function seedObjects(r2, userId, n) {
  for (let i = 0; i < n; i += 1) await r2.put(`${userId}/resumes/r${i}`, new Uint8Array([1, 2, 3]));
}

test("删除账号时清除该用户 R2 前缀下全部对象，分页也删干净", async () => {
  const r2 = createFakeR2({ pageSize: 2 });
  const { env, deps } = await makeEnv({ RESUMES: r2 });
  const a = await activeUser(env, deps, "a@example.test");
  const b = await activeUser(env, deps, "b@example.test");
  await seedObjects(r2, a.user.id, 5);
  await seedObjects(r2, b.user.id, 1);
  assert.equal((await a.post("/account/delete", { password: "password-123" })).status, 303);
  assert.deepEqual(r2.keys(), [`${b.user.id}/resumes/r0`]);
});

test("管理员删除用户同样清除其 R2 对象", async () => {
  const r2 = createFakeR2();
  const { env, deps } = await makeEnv({ RESUMES: r2 });
  const admin = await activeUser(env, deps, "admin@example.test", { role: "admin" });
  const user = await activeUser(env, deps, "u@example.test");
  await seedObjects(r2, user.user.id, 2);
  assert.equal((await admin.post(`/admin/users/${user.user.id}/delete`)).status, 303);
  assert.deepEqual(r2.keys(), []);
});

test("前缀不会误删 ID 相同开头的其他用户对象", async () => {
  const r2 = createFakeR2();
  const { env, deps } = await makeEnv({ RESUMES: r2 });
  const a = await activeUser(env, deps, "a@example.test");
  await r2.put(`${a.user.id}x/resumes/r0`, new Uint8Array([1]));
  await a.post("/account/delete", { password: "password-123" });
  assert.deepEqual(r2.keys(), [`${a.user.id}x/resumes/r0`]);
});

test("新表都登记在 USER_TABLES", () => {
  for (const table of ["resumes", "profile_versions", "profile_drafts", "profiles", "llm_usage"]) {
    assert.ok(USER_TABLES.includes(table), table);
  }
});

test("deleteAll 后该用户新表行数为 0", async () => {
  const { env, deps } = await makeEnv();
  const a = await activeUser(env, deps, "a@example.test");
  const db = env.PRIVATE_DB;
  const id = a.user.id;
  await db.prepare("INSERT INTO resumes (id, user_id, filename, mime, size, uploaded_at) VALUES ('r1', ?, 'cv.pdf', 'application/pdf', 3, 1)").bind(id).run();
  await db.prepare("INSERT INTO profiles (user_id, data_json, version, confirmed_at) VALUES (?, '{}', 1, 1)").bind(id).run();
  await db.prepare("INSERT INTO profile_versions (id, user_id, version, data_json, confirmed_at) VALUES ('v1', ?, 1, '{}', 1)").bind(id).run();
  await db.prepare("INSERT INTO profile_drafts (id, user_id, profile_json, target_json, source, status, created_at) VALUES ('d1', ?, '{}', '{}', 'intent', 'pending', 1)").bind(id).run();
  await db.prepare("INSERT INTO llm_usage (user_id, day, calls, tokens) VALUES (?, '2026-11-12', 1, 10)").bind(id).run();
  await a.post("/consent", { agree: "yes", version: CONSENT_VERSION });
  await a.post("/goals", { title: "t", description: "d" });
  await db.prepare("UPDATE goals SET target_json = '{}' WHERE user_id = ?").bind(id).run();
  assert.equal((await a.post("/account/delete", { password: "password-123" })).status, 303);
  for (const table of USER_TABLES) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(id).first()).n, 0, table);
  }
});

test("R2 删除失败时数据库不删", async () => {
  const r2 = createFakeR2({ failDelete: true });
  const { env, deps } = await makeEnv({ RESUMES: r2 });
  const a = await activeUser(env, deps, "a@example.test");
  await seedObjects(r2, a.user.id, 1);
  const response = await a.post("/account/delete", { password: "password-123" });
  assert.equal(response.status, 500);
  assert.ok(await findUserByEmail(env.PRIVATE_DB, "a@example.test"));
});
