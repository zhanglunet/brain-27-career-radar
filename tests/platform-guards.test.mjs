/** 静态守卫：用代码扫描守住数据隔离与"永不写公开库"的纪律。 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlatformMigrations, createSqliteD1 } from "./helpers/sqlite-d1.mjs";
import { ID_ONLY_TABLES, USER_TABLES } from "../platform/data/tables.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const PRIVATE_TABLES = [
  "users", "invites", "sessions", "consents", "password_resets", "login_attempts", "goals", "audit_log",
  "resumes", "profiles", "profile_versions", "profile_drafts", "llm_usage",
  "goal_sources", "find_runs", "user_opportunities", "page_cache", "robots_cache", "platform_sources", "source_nominations",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(relative(REPO, path).split("\\").join("/"));
  }
  return out;
}

const platformFiles = () => walk(join(REPO, "platform")).filter((file) => file.endsWith(".ts"));
const read = (file) => readFileSync(join(REPO, file), "utf-8");

test("用户表 SQL 只出现在 platform/data/", () => {
  const pattern = new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+(${PRIVATE_TABLES.join("|")})\\b`, "i");
  const offenders = platformFiles().filter((file) => !file.startsWith("platform/data/") && pattern.test(read(file)));
  assert.deepEqual(offenders, []);
});

test("PUBLIC_DB 只出现在 public-readonly.ts 和 env.ts", () => {
  const allowed = new Set(["platform/data/public-readonly.ts", "platform/env.ts", "platform/wrangler.jsonc"]);
  const offenders = walk(join(REPO, "platform")).filter((file) => !allowed.has(file) && read(file).includes("PUBLIC_DB"));
  assert.deepEqual(offenders, []);
});

test("public-readonly.ts 不含写语句", () => {
  assert.doesNotMatch(read("platform/data/public-readonly.ts"), /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/i);
});

test("每张含用户 ID 列的表都登记在 USER_TABLES 或 ID_ONLY_TABLES", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const registered = new Set([...USER_TABLES, ...ID_ONLY_TABLES]);
  for (const { name } of results) {
    const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).results.map((column) => column.name);
    if (columns.some((column) => column === "user_id" || column.endsWith("_user_id"))) {
      assert.ok(registered.has(name), `${name} 含用户 ID 列但未登记`);
    }
  }
});

test("platform/ 不含领域专属词", () => {
  const offenders = walk(join(REPO, "platform")).filter((file) => /脑科学|心理学|2027|BRAIN \/ 27|brain27/i.test(read(file)));
  assert.deepEqual(offenders, []);
});
