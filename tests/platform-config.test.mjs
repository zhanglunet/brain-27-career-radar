import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(REPO, file), "utf-8");
const parseJsonc = (source) => JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));

const DEPLOY_ENV = {
  PLATFORM_D1_ID: "11111111-1111-1111-1111-111111111111",
  PUBLIC_D1_ID: "22222222-2222-2222-2222-222222222222",
  PLATFORM_HOST: "jobs.example.test",
  ACCESS_TEAM_DOMAIN: "team.example.test",
  ACCESS_AUD: "aud-xyz",
};

function runDeploy(args, env) {
  return spawnSync(process.execPath, [join(REPO, "scripts/platform-deploy.mjs"), ...args], {
    cwd: REPO,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf-8",
  });
}

function fakeWrangler({ migrationsExit }) {
  const dir = mkdtempSync(join(tmpdir(), "fake-wrangler-"));
  const log = join(dir, "calls.log");
  const bin = join(dir, "wrangler");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\ncase "$*" in *migrations*) exit ${migrationsExit};; esac\nexit 0\n`);
  chmodSync(bin, 0o755);
  return { dir, calls: () => { try { return readFileSync(log, "utf-8"); } catch { return ""; } } };
}

test("私有平台配置关闭 workers.dev 与预览 URL，且无 cron / assets；绑定 RESUMES 与 AI", () => {
  const config = parseJsonc(read("platform/wrangler.jsonc"));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.triggers, undefined);
  assert.equal(config.assets, undefined);
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.deepEqual(config.r2_buckets, [{ binding: "RESUMES", bucket_name: "job-agent-platform-resumes" }]);
  assert.deepEqual(config.d1_databases.map((db) => db.binding).sort(), ["PRIVATE_DB", "PUBLIC_DB"]);
  assert.equal(config.main, "./worker.ts");
});

test("公开实例配置不含任何私有绑定", () => {
  const source = read("vite.config.ts");
  for (const marker of ["PRIVATE_DB", "PUBLIC_DB", "DEEPSEEK", "r2_buckets", "RESUMES", "platform/"]) assert.ok(!source.includes(marker), marker);
});

test("部署脚本缺环境变量时退出码 1 并列出缺失项，不调用 wrangler", () => {
  const fake = fakeWrangler({ migrationsExit: 0 });
  const result = runDeploy([], { PATH: `${fake.dir}:${process.env.PATH}` });
  assert.equal(result.status, 1);
  for (const name of Object.keys(DEPLOY_ENV)) assert.match(result.stderr, new RegExp(name));
  assert.equal(fake.calls(), "");
});

test("部署脚本 --dry-run 生成的配置含自定义域名、真实 ID 与 Access 变量", () => {
  const fake = fakeWrangler({ migrationsExit: 0 });
  const result = runDeploy(["--dry-run"], { ...DEPLOY_ENV, PATH: `${fake.dir}:${process.env.PATH}` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fake.calls(), "");
  const config = JSON.parse(read("dist/platform/wrangler.json"));
  assert.deepEqual(config.routes, [{ pattern: "jobs.example.test", custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  const byBinding = Object.fromEntries(config.d1_databases.map((db) => [db.binding, db]));
  assert.equal(byBinding.PRIVATE_DB.database_id, DEPLOY_ENV.PLATFORM_D1_ID);
  assert.equal(byBinding.PUBLIC_DB.database_id, DEPLOY_ENV.PUBLIC_D1_ID);
  assert.equal(config.vars.PLATFORM_HOST, "jobs.example.test");
  assert.equal(config.vars.ACCESS_AUD, "aud-xyz");
  assert.equal(config.vars.ACCESS_TEAM_DOMAIN, "team.example.test");
  assert.deepEqual(config.r2_buckets, [{ binding: "RESUMES", bucket_name: "job-agent-platform-resumes" }]);
  assert.deepEqual(config.ai, { binding: "AI" });
  assert.ok(config.main.endsWith("platform/worker.ts") && config.main.startsWith("/"));
  assert.ok(byBinding.PRIVATE_DB.migrations_dir.endsWith("platform/migrations") && byBinding.PRIVATE_DB.migrations_dir.startsWith("/"));
});

test("迁移失败时不执行部署", () => {
  const fake = fakeWrangler({ migrationsExit: 1 });
  const result = runDeploy([], { ...DEPLOY_ENV, PATH: `${fake.dir}:${process.env.PATH}` });
  assert.notEqual(result.status, 0);
  assert.match(fake.calls(), /migrations/);
  assert.doesNotMatch(fake.calls(), /^deploy/m);
});

test("迁移成功后才部署，且都指向生成的配置", () => {
  const fake = fakeWrangler({ migrationsExit: 0 });
  const result = runDeploy([], { ...DEPLOY_ENV, PATH: `${fake.dir}:${process.env.PATH}` });
  assert.equal(result.status, 0, result.stderr);
  const lines = fake.calls().trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^d1 migrations apply PRIVATE_DB --remote --config .*dist\/platform\/wrangler\.json$/);
  assert.match(lines[1], /^deploy --config .*dist\/platform\/wrangler\.json$/);
});
