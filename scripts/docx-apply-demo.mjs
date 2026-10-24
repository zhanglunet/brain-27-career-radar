#!/usr/bin/env node
/**
 * PRD-150/T4：申请助手流程对接演示（trend #753）——从申请草稿一键生成求职信 .docx。
 *
 * PRD-080 申请助手的产物三件套（机会 JSON / 用户档案 / 求职信匹配段草稿，
 * 形状见 examples/apply-draft-sample/，全部虚构）直接喂 T3 的 docx-generate 入口：
 *
 *   node scripts/docx-apply-demo.mjs [--out <dir>]
 *
 * 等价手工命令（演示即文档）：
 *   npm run docx:generate -- --template cover-letter \
 *     --profile examples/apply-draft-sample/profile.json \
 *     --opportunity examples/apply-draft-sample/opportunity.json \
 *     --letter-draft examples/apply-draft-sample/letter-draft.md \
 *     --opportunity-id opp-demo-2026-042 --out <dir>
 *
 * 数据不出本机：渲染纯本地计算，无网络请求（G23 断言钉住渲染路径零 fetch）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = join(REPO, "examples", "apply-draft-sample");
// --out 精确使用（不再追加子目录）；缺省落 outputs/apply-demo/
const OUT = resolve(process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : join(REPO, "outputs", "apply-demo"));

mkdirSync(OUT, { recursive: true });

const args = [
  "run", "--silent", "docx:generate", "--",
  "--template", "cover-letter",
  "--profile", join(SAMPLE, "profile.json"),
  "--opportunity", join(SAMPLE, "opportunity.json"),
  "--letter-draft", join(SAMPLE, "letter-draft.md"),
  "--opportunity-id", "opp-demo-2026-042",
  "--out", OUT,
];
const run = spawnSync("npm", args, { cwd: REPO, encoding: "utf-8" });
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");
if (run.status !== 0) {
  process.stderr.write(`演示失败：docx-generate 退出码 ${run.status}\n`);
  process.exit(run.status ?? 1);
}
const product = join(OUT, "cover_letter-opp-demo-2026-042-v1.docx");
if (!existsSync(product)) {
  process.stderr.write(`演示失败：未找到产物 ${product}\n`);
  process.exit(1);
}
console.log(`演示通过：申请草稿三件套 → ${product}`);
