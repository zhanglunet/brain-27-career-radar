#!/usr/bin/env node
/**
 * 私有平台部署：校验环境变量 → 生成 dist/platform/wrangler.json → 远程迁移 → 部署。
 * 迁移失败立即退出，绝不继续部署。`--dry-run` 只生成配置。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = ["PLATFORM_D1_ID", "PUBLIC_D1_ID", "PLATFORM_HOST", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"];
const OUTPUT = join(REPO, "dist/platform/wrangler.json");

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`缺少环境变量：${missing.join(", ")}`);
  process.exit(1);
}

const template = JSON.parse(readFileSync(join(REPO, "platform/wrangler.jsonc"), "utf-8").replace(/^\s*\/\/.*$/gm, ""));
const host = process.env.PLATFORM_HOST.trim().toLowerCase();
const config = {
  ...template,
  main: join(REPO, "platform/worker.ts"),
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: host, custom_domain: true }],
  vars: {
    ...template.vars,
    PLATFORM_HOST: host,
    ACCESS_TEAM_DOMAIN: process.env.ACCESS_TEAM_DOMAIN,
    ACCESS_AUD: process.env.ACCESS_AUD,
  },
  d1_databases: template.d1_databases.map((db) => db.binding === "PRIVATE_DB"
    ? { ...db, database_id: process.env.PLATFORM_D1_ID, migrations_dir: join(REPO, "platform/migrations") }
    : { ...db, database_id: process.env.PUBLIC_D1_ID }),
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(config, null, 2)}\n`);
console.log(`已生成 ${OUTPUT}`);
if (process.argv.includes("--dry-run")) process.exit(0);

function wrangler(args) {
  const result = spawnSync("wrangler", args, { stdio: "inherit", cwd: REPO });
  if (result.status !== 0) {
    console.error(`wrangler ${args[0]} 失败（退出码 ${result.status ?? "无"}），已停止。`);
    process.exit(result.status || 1);
  }
}

wrangler(["d1", "migrations", "apply", "PRIVATE_DB", "--remote", "--config", OUTPUT]);
wrangler(["deploy", "--config", OUTPUT]);
