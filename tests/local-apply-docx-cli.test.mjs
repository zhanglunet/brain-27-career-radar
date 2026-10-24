/**
 * PRD-150/T3 · 一键生成入口端到端测试（trend #752）。
 *
 * 验收：本地可一键生成——真实拉起 scripts/docx-generate.mjs 子进程
 * （入口命令 → .docx 落盘），用 node:zlib 手写最小 ZIP 读取器重开产物
 * 断言内容（与 T2 tests/local-apply-docx.test.mjs 同一读取器，不引入
 * 测试专用依赖）。样例数据全部虚构（T1 §3.1 纪律）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import { AI_DRAFT_MARKER } from "../lib/local-apply/drafter.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "../scripts/docx-generate.mjs");
const SAMPLE_PROFILE = join(HERE, "../examples/doc-profile.sample.json");

// ── 最小 ZIP 读取器（与 T2 测试同一实现）──────────────────────

function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "not a zip: EOCD not found");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n += 1) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50, "bad central directory entry");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(localOff), 0x04034b50, `bad local header: ${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 重开 .docx：返回 word/document.xml 文本。 */
function reopenDocument(bytes) {
  assert.ok(bytes.length > 0, "docx bytes empty");
  assert.equal(bytes[0], 0x50, "zip magic P");
  assert.equal(bytes[1], 0x4b, "zip magic K");
  const entries = readZipEntries(bytes);
  const doc = entries["word/document.xml"]?.toString("utf8") ?? "";
  assert.ok(doc.length > 0, "word/document.xml missing");
  return doc;
}

// ── 子进程拉起入口（Node 22.6–22.17 需 strip-types 标志；≥22.18 兼容）──

function runCli(args, options = {}) {
  return new Promise((resolveRun) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, ...args],
      { cwd: options.cwd ?? HERE, env: options.env },
      (error, stdout, stderr) => {
        resolveRun({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}

// ── 虚构样例（与 T2 测试同源；T1 §3.1 全虚构纪律）────────────

async function writeFixture(dir, name, content) {
  const path = join(dir, name);
  await writeFile(path, content, "utf-8");
  return path;
}

const FIXTURE_OPPORTUNITY_JSON = JSON.stringify({
  id: "opp-sample-001",
  title: "脑机接口方向博士项目（虚构示例）",
  org: "某大学",
  type: "phd",
  region: "英国",
  deadline: "2026-12-15",
  keywords: ["EEG", "Python", "脑机接口"],
  mentors: ["某教授（示例）"],
  description: "虚构示例机会，仅用于测试",
});

const FIXTURE_LETTER_MD = [
  "> ⚠️ AI 草稿，需人工改写",
  "",
  "我近期围绕脑机接口完成了 EEG 信号处理管线的搭建（虚构示例），",
  "希望在贵校继续深入该方向的研究计划（虚构示例）。",
].join("\n");

// ── 端到端用例 ────────────────────────────────────────────────

test("PRD150/T3-1 · 一键生成 resume：入口命令 → outputs/ 落盘 → 重开断言", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-docx-cli-"));
  try {
    // 缺省 --out = outputs/（相对子进程 cwd；仓库内该目录已在 .gitignore）
    const r = await runCli(
      ["--template", "resume", "--profile", SAMPLE_PROFILE, "--opportunity-id", "opp-sample-001"],
      { cwd: work },
    );
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("cv-opp-sample-001-v1.docx"), "报告文件名（T1 §4.3 约定）");
    assert.ok(!r.stdout.includes("⚠️"), "样例档案字段齐全，无占位符警告");

    const outPath = join(work, "outputs", "cv-opp-sample-001-v1.docx");
    const document = reopenDocument(await readFile(outPath));
    assert.ok(document.includes("王某某"), "姓名行");
    assert.ok(document.includes("某大学心理与认知科学学院"), "教育区块");
    assert.ok(document.includes(AI_DRAFT_MARKER), "非 final 默认带 AI 标注段");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("PRD150/T3-2 · 一键生成 cover-letter：机会注入 + 匹配段草稿 + --final 终稿", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-docx-cli-"));
  try {
    const opportunity = await writeFixture(work, "opp.json", FIXTURE_OPPORTUNITY_JSON);
    const letter = await writeFixture(work, "letter.md", FIXTURE_LETTER_MD);
    const r = await runCli([
      "--template", "cover-letter",
      "--profile", SAMPLE_PROFILE,
      "--opportunity", opportunity,
      "--letter-draft", letter,
      "--opportunity-id", "opp-sample-001",
      "--version", "2",
      "--final",
      "--out", join(work, "letters"),
    ]);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("cover_letter-opp-sample-001-v2.docx"), "kind=cover_letter + 版本号");

    const outPath = join(work, "letters", "cover_letter-opp-sample-001-v2.docx");
    const document = reopenDocument(await readFile(outPath));
    assert.ok(document.includes("收件：某教授（示例）"), "机会导师注入信头");
    assert.ok(document.includes("脑机接口方向博士项目（虚构示例）"), "来意段机会标题");
    assert.ok(document.includes("EEG 信号处理管线的搭建"), "匹配段草稿正文");
    assert.ok(!document.includes(AI_DRAFT_MARKER), "--final 终稿无 AI 标注段");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("PRD150/T3-3 · --list-placeholders：空档案列出全部缺失必选字段，不写文件", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-docx-cli-"));
  try {
    const empty = await writeFixture(work, "empty.json", "{}");
    const outDir = join(work, "should-not-exist");
    const r = await runCli([
      "--template", "resume", "--profile", empty, "--out", outDir, "--list-placeholders",
    ]);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    for (const path of ["basics.name", "education", "experience", "skills"]) {
      assert.ok(r.stdout.includes(`[待填写：${path}]`), `列出 ${path}`);
    }
    const entries = await readdir(work);
    assert.ok(!entries.includes("should-not-exist"), "--list-placeholders 不写任何文件");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("PRD150/T3-4 · 用法/文件错误：非零退出 + stderr 提示", async () => {
  const bogus = await runCli(["--template", "bogus"]);
  assert.notEqual(bogus.code, 0, "非法模板退出码非 0");
  assert.ok(bogus.stderr.includes("resume"), "stderr 指明合法取值");

  const missing = await runCli(["--template", "resume", "--profile", "/nonexistent/profile.json"]);
  assert.notEqual(missing.code, 0);
  assert.ok(missing.stderr.includes("不存在"), "stderr 报档案缺失");

  const unknown = await runCli(["--totally-unknown-flag"]);
  assert.notEqual(unknown.code, 0);
  assert.ok(unknown.stderr.includes("未知参数"), "stderr 报未知参数");

  // 默认档案路径（~/.brain27/profile.json）缺失时给出样例试跑提示：
  // 用假 HOME 隔离，绝不触碰真实 ~/.brain27。
  const fakeHome = await mkdtemp(join(tmpdir(), "brain27-fake-home-"));
  try {
    const r = await runCli(["--template", "resume"], {
      env: { ...process.env, HOME: fakeHome },
      cwd: fakeHome,
    });
    assert.notEqual(r.code, 0);
    assert.ok(r.stderr.includes("examples/doc-profile.sample.json"), "提示虚构样例试跑");
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("PRD150/T3-5 · --help：打印用法；输出只含路径不含档案字段值", async () => {
  const r = await runCli(["--help"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes("--template"), "用法含 --template");
  assert.ok(r.stdout.includes("--list-placeholders"), "用法含辅助参数");
  assert.ok(r.stdout.includes("数据不出本机") || r.stdout.includes("数据主权"), "声明数据边界");
});

test("PRD150/T3-6 · 入口脚本静态纪律：零网络 import（G23 精神延伸到 scripts 入口）", async () => {
  const source = await readFile(SCRIPT, "utf-8");
  const codeLines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("*") && !l.startsWith("//") && !l.startsWith("/*"));
  for (const pat of ["fetch(", "XMLHttpRequest", "WebSocket", "node:http", "node:https", "https.request", "http.request", "nodemailer", "smtp"]) {
    const hits = codeLines.filter((l) => l.includes(pat));
    assert.equal(hits.length, 0, `scripts/docx-generate.mjs 不应含网络调用 ${pat}，命中: ${hits[0] ?? ""}`);
  }
  // import 白名单：相对路径（docx 渲染引擎）/ node: 内建
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const imp of imports) {
    assert.ok(
      imp.startsWith("../") || imp.startsWith("node:"),
      `${SCRIPT} 非白名单 import: ${imp}`,
    );
  }
});

// ── 辅助：临时目录清理统一用 node:fs/promises 的 rm（顶部已 import）──
