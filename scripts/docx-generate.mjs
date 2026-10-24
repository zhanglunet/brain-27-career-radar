#!/usr/bin/env node
/**
 * brain27 本地求职文档 .docx 一键生成入口 —— PRD-150/T3（trend #752）。
 *
 * 上游（T2，lib/local-apply/docx/）：profile.ts 字段模型 / render.ts 渲染落盘
 * / templates/{resume,cover-letter}.ts 模板 / placeholder.ts 占位符约定。
 * 本脚本只做「解析参数 → 读本地文件 → 渲染 → 落盘 → 打印结果」的编排，
 * 不改 lib/local-apply/cli.ts（PRD-097 #54 域），是独立的 docx 专用入口。
 *
 * ── 数据主权红线（延续 PRD-150/T1 §五、PRD-080）──────────────
 * 1. 全程本地：只读本地 JSON/文本、只写 --out 目录（缺省 outputs/，
 *    已在 .gitignore），无任何网络请求、无上传/发送/投递通道；
 * 2. 命令行输出只含路径、字段路径、文件名与字节数，不回显档案字段值；
 * 3. 入库样例一律虚构（examples/doc-profile.sample.json，T1 §3.1 纪律）；
 *    真实档案只存在于用户本机 ~/.brain27/profile.json，不入库。
 *
 * 运行：Node ≥ 22.6 需带 --experimental-strip-types（npm run docx:generate
 * 已内置）；Node ≥ 22.18 起默认支持类型剥离，可直接
 * `node scripts/docx-generate.mjs ...`（与 tests/*.test.mjs 引 .ts 同机制）。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { parseJobDocProfile } from "../lib/local-apply/docx/profile.ts";
import { renderJobDoc, writeRenderedDoc } from "../lib/local-apply/docx/render.ts";

const USAGE = `brain27 本地求职文档 .docx 一键生成（PRD-150/T3，数据不出本机）

用法：
  npm run docx:generate -- --template <resume|cover-letter> [选项]
  node --experimental-strip-types scripts/docx-generate.mjs --template <resume|cover-letter> [选项]

选项：
  --template <resume|cover-letter>  模板类型（必填）：resume=中文简历；cover-letter=中文求职信
  --profile <path>                  档案 JSON：JobDocProfile 六区块嵌套形状，或老平铺形状
                                    （degree/researchInterests/skills/experience/name 自动归一）；
                                    缺省 ~/.brain27/profile.json
  --out <dir>                       输出目录（缺省 outputs/，已在 .gitignore）
  --opportunity-id <id>             机会 ID，进文件名（缺省 general）
  --version <n>                     版本号，进文件名（缺省 1，正整数）
  --opportunity <path>              机会 JSON（title/org/type/region/deadline/keywords/mentors，
                                    全为公开情报；cover-letter 信头/来意段/佐证段用，可选）
  --letter-draft <path>             求职信匹配段草稿文件（Markdown/文本，materials 草稿只读
                                    消费；cover-letter 用，可选）
  --final                           人工定稿版：不带 AI 草稿标注段（缺省带标注，T1 §3.3）
  --list-placeholders               只列出缺失必选字段（[待填写：…]），不写任何文件
  -h, --help                        本帮助

产物命名（T1 §4.3）：{kind}-{opportunityId}-v{version}.docx
  kind：resume → cv；cover-letter → cover_letter

退出码：0 = 成功（含产物留有占位符的情况，此时逐条打印 ⚠️ 警告）；1 = 用法/文件错误。

数据主权：渲染全程无网络请求；产物只是本地文件，由用户手动投递（不代发）。`;

/** 需要跟一个值的选项。 */
const VALUE_FLAGS = new Set([
  "--template",
  "--profile",
  "--out",
  "--opportunity-id",
  "--version",
  "--opportunity",
  "--letter-draft",
]);

const TEMPLATES = new Set(["resume", "cover-letter"]);

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = {
    template: undefined,
    profile: undefined,
    out: "outputs",
    opportunityId: "general",
    version: 1,
    opportunity: undefined,
    letterDraft: undefined,
    final: false,
    listPlaceholders: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "--final") {
      opts.final = true;
    } else if (arg === "--list-placeholders") {
      opts.listPlaceholders = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} 需要一个值`);
      i += 1;
      switch (arg) {
        case "--template":
          opts.template = value;
          break;
        case "--profile":
          opts.profile = value;
          break;
        case "--out":
          opts.out = value;
          break;
        case "--opportunity-id":
          opts.opportunityId = value;
          break;
        case "--version":
          opts.version = value;
          break;
        case "--opportunity":
          opts.opportunity = value;
          break;
        case "--letter-draft":
          opts.letterDraft = value;
          break;
      }
    } else {
      throw new UsageError(`未知参数：${arg}`);
    }
  }
  return opts;
}

/** 机会 ID 进文件名：只留安全字符，防路径穿越（本地单用户工具的顺手加固）。 */
function safeFileToken(value, fallback) {
  const token = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : fallback;
}

async function readJsonFile(path, what) {
  let text;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    throw new UsageError(`${what}文件不存在或不可读：${path}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${what}不是合法 JSON：${path}（${e.message}）`);
  }
}

/**
 * 机会 JSON → OpportunityInput（drafter.ts 形状）宽容归一：
 * 字段缺失降级为空串/undefined，渲染层对必选槽留 [待填写：opportunity.*]，
 * 不阻断生成（与 parseJobDocProfile 同一宽容策略）。
 */
function coerceOpportunity(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UsageError("--opportunity 文件内容须是 JSON 对象");
  }
  const str = (v) => (typeof v === "string" && v.length > 0 ? v : "");
  const strArray = (v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0) : undefined;
  const opportunity = {
    id: str(raw.id),
    title: str(raw.title),
    org: str(raw.org),
    type: str(raw.type),
    region: str(raw.region) || undefined,
    deadline: str(raw.deadline) || null,
    keywords: strArray(raw.keywords),
    mentors: strArray(raw.mentors),
    description: str(raw.description) || undefined,
  };
  return opportunity;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`错误：${e.message}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!TEMPLATES.has(opts.template ?? "")) {
    process.stderr.write(`错误：--template 必须是 resume 或 cover-letter\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  if (!/^\d+$/.test(String(opts.version)) || Number(opts.version) < 1) {
    process.stderr.write(`错误：--version 须为正整数\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    // 1. 档案：显式路径或缺省 ~/.brain27/profile.json（T1 §4.1 档案同源）。
    const profilePath = opts.profile ?? join(homedir(), ".brain27", "profile.json");
    let rawProfile;
    try {
      rawProfile = await readJsonFile(profilePath, "档案（--profile）");
    } catch (e) {
      if (!opts.profile) {
        throw new UsageError(
          `默认档案不存在：${profilePath}。可先用虚构样例试跑：` +
            "npm run docx:generate -- --template resume --profile examples/doc-profile.sample.json",
        );
      }
      throw e;
    }
    const profile = parseJobDocProfile(rawProfile); // 宽容：非法形状降级空档案

    // 2. 机会 + 匹配段草稿（均本地文件、可选；只读消费，不回写）。
    const opportunity = opts.opportunity
      ? coerceOpportunity(await readJsonFile(opts.opportunity, "机会（--opportunity）"))
      : undefined;
    const letterDraft = opts.letterDraft
      ? await readFile(opts.letterDraft, "utf-8").catch(() => {
          throw new UsageError(`草稿文件不存在或不可读：${opts.letterDraft}`);
        })
      : undefined;

    // 3. 渲染（纯本地计算；T1 §3.2：必选缺失不阻断，占位符入文 + warnings）。
    const result = await renderJobDoc({
      template: opts.template,
      opportunityId: safeFileToken(opts.opportunityId, "general"),
      version: Number(opts.version),
      profile,
      opportunity,
      letterDraft,
      final: opts.final,
    });

    // 4a. --list-placeholders：只报告缺失必选字段，不写任何文件。
    if (opts.listPlaceholders) {
      if (result.placeholders.length === 0) {
        process.stdout.write("无缺失必选字段，可直接生成。\n");
      } else {
        process.stdout.write(
          `缺失必选字段 ${result.placeholders.length} 处（${opts.template} 模板）：\n`,
        );
        for (const warning of result.warnings) process.stdout.write(`⚠️ ${warning}\n`);
      }
      return;
    }

    // 4b. 落盘（唯一磁盘写入口 writeRenderedDoc；目录不存在自动创建）。
    const outDir = resolve(opts.out);
    const outPath = await writeRenderedDoc(result, outDir);
    process.stdout.write(
      `已生成：${outPath}（${result.template} 模板，${result.bytes.length} 字节）\n`,
    );
    if (result.warnings.length > 0) {
      process.stdout.write(
        `⚠️ 占位符残留 ${result.warnings.length} 处，导出终稿前请人工补填：\n`,
      );
      for (const warning of result.warnings) process.stdout.write(`⚠️ ${warning}\n`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`错误：${e.message}\n用 -h 查看用法。\n`);
    } else {
      process.stderr.write(`错误：${e.message}\n`);
    }
    process.exitCode = 1;
  }
}

await main();
