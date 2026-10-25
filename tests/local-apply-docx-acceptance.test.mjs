/**
 * PRD-150/T5 · 验收测试（trend #754）——数据不出本机 / 样例文档合格 / 无真实隐私样例入库。
 *
 * 三条验收标准的机器断言：
 * ① 零网络：
 *    a) 静态——渲染路径（scripts 入口 + lib/local-apply/docx/** + drafter.ts）AST 扫描
 *       （typescript 编译器 API 解析，注释/字符串不误伤）：import 白名单（相对路径、
 *       非网络类 node: 内建、docx 渲染库）、零 fetch/WebSocket/XMLHttpRequest 调用、
 *       零网络类内建 import、动态 import 同白名单；
 *    b) 运行——tests/helpers/net-block.mjs 预加载把 socket/dns/fetch 全部封死后，
 *       docx-generate（两模板）与 docx-apply-demo（npm→node 子进程链经 NODE_OPTIONS
 *       一并封死）仍照常产出可重开的 .docx；
 * ② 样例文档合格：两模板样例 .docx 重开断言（段落结构 / 占位符入文 / AI 标注段
 *    默认携带、--final 消除）；
 * ③ 无真实隐私样例入库：examples/ 与 docs/ 全量隐私扫描——非 example.* 域邮箱、
 *    大陆手机号、18 位身份证号即红；占位符与 example.com/example.dev 域放行，
 *    历史运维记录中的仓库主自有账户名显式豁免（非样例数据，T5 前已存在）。
 *
 * 样例数据全部虚构（T1 §3.1 纪律）；与 T2/T3 测试同一最小 ZIP 读取器，不引入新依赖
 * （AST 扫描用 devDependencies 已声明的 typescript）。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import ts from "typescript";

import { AI_DRAFT_MARKER } from "../lib/local-apply/drafter.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const GENERATE = join(REPO, "scripts/docx-generate.mjs");
const APPLY_DEMO = join(REPO, "scripts/docx-apply-demo.mjs");
const NET_BLOCK = join(REPO, "tests/helpers/net-block.mjs");
const SAMPLE_PROFILE = join(REPO, "examples/doc-profile.sample.json");
const APPLY_SAMPLE = join(REPO, "examples/apply-draft-sample");
const NET_BLOCK_ARGS = ["--experimental-strip-types", "--import", NET_BLOCK];

// ── 最小 ZIP 读取器（与 T2/T3 测试同一实现）──────────────────────

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

function reopenDocument(bytes) {
  assert.ok(bytes.length > 0, "docx bytes empty");
  assert.equal(bytes[0], 0x50, "zip magic P");
  assert.equal(bytes[1], 0x4b, "zip magic K");
  const entries = readZipEntries(bytes);
  const doc = entries["word/document.xml"]?.toString("utf8") ?? "";
  assert.ok(doc.length > 0, "word/document.xml missing");
  return doc;
}

function runNode(args, options = {}) {
  return new Promise((resolveRun) => {
    execFile(
      process.execPath,
      args,
      { cwd: options.cwd ?? REPO, env: options.env },
      (error, stdout, stderr) => resolveRun({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

// ── ①a 静态：渲染路径 AST 扫描 ────────────────────────────────

/** 渲染路径闭包：docx-generate 可达的全部自有源码 + apply-demo 编排脚本。 */
const RENDER_PATH_FILES = [
  "scripts/docx-generate.mjs",
  "scripts/docx-apply-demo.mjs",
  "lib/local-apply/docx/profile.ts",
  "lib/local-apply/docx/render.ts",
  "lib/local-apply/docx/placeholder.ts",
  "lib/local-apply/docx/templates/types.ts",
  "lib/local-apply/docx/templates/resume.ts",
  "lib/local-apply/docx/templates/cover-letter.ts",
  "lib/local-apply/drafter.ts",
];

/** 网络类内建（含裸名与 node: 前缀两种写法）——渲染路径一律禁入。 */
const NET_MODULE_STEMS = new Set(["http", "https", "net", "dns", "dgram", "tls", "undici"]);
/** 非网络类 node: 内建白名单外的裸包名：渲染路径只许 docx 一个三方库。 */
const ALLOWED_BARE_PACKAGES = new Set(["docx"]);

function moduleAllowed(specifier) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true; // 仓库内相对引用
  if (specifier.startsWith("node:")) {
    return !NET_MODULE_STEMS.has(specifier.slice("node:".length));
  }
  if (NET_MODULE_STEMS.has(specifier)) return false; // 裸网络内建（http/https/net…）
  return ALLOWED_BARE_PACKAGES.has(specifier);       // 其余裸包名一律拒绝（只许 docx）
}

/** AST 断言：import 白名单 + 零网络调用。注释/字符串里的字样不会误伤（对 T3-6 行过滤的升级）。 */
function assertNoNetworkInAst(source, fileLabel) {
  const sf = ts.createSourceFile(fileLabel, source, ts.ScriptTarget.ES2022, true,
    fileLabel.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const netCalls = [];
  const badImports = [];
  const visit = (node) => {
    const checkSpecifier = (specNode, kind) => {
      const spec = specNode?.text;
      if (typeof spec !== "string") {
        badImports.push(`${kind}: 非字面量说明符`);
        return;
      }
      if (!moduleAllowed(spec)) badImports.push(`${kind} "${spec}"`);
    };
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkSpecifier(node.moduleSpecifier, "import");
    } else if (ts.isCallExpression(node)) {
      // 动态 import()：说明符走同一白名单
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        checkSpecifier(node.arguments?.[0], "dynamic-import");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        netCalls.push("fetch()");
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === "XMLHttpRequest" || name === "WebSocket") netCalls.push(`new ${name}()`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.deepEqual(badImports, [], `${fileLabel}: 非白名单 import —— ${badImports.join("; ")}`);
  assert.deepEqual(netCalls, [], `${fileLabel}: 网络调用 —— ${netCalls.join("; ")}`);
}

test("PRD150/T5-1a · 零网络静态断言：渲染路径 import/调用 AST 扫描全绿", async () => {
  for (const rel of RENDER_PATH_FILES) {
    const source = await readFile(join(REPO, rel), "utf-8");
    assertNoNetworkInAst(source, rel);
  }
  // AST 扫描确实「看见」了带网络字样的注释而不误伤（源码里就有这类红线声明）
  const renderSrc = await readFile(join(REPO, "lib/local-apply/docx/render.ts"), "utf-8");
  assert.ok(renderSrc.includes("网络") || renderSrc.includes("本地"), "扫描对象确实是渲染模块");
});

// ── ①b 运行：socket 封死后照常产出 ────────────────────────────

test("PRD150/T5-1b · socket/dns/fetch 封死后 docx-generate 两模板仍照常产出", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-t5-netblock-"));
  try {
    for (const args of [
      ["--template", "resume", "--profile", SAMPLE_PROFILE, "--out", work],
      ["--template", "cover-letter",
        "--profile", join(APPLY_SAMPLE, "profile.json"),
        "--opportunity", join(APPLY_SAMPLE, "opportunity.json"),
        "--letter-draft", join(APPLY_SAMPLE, "letter-draft.md"),
        "--out", work],
    ]) {
      const r = await runNode([...NET_BLOCK_ARGS, GENERATE, ...args]);
      assert.equal(r.code, 0, `socket 封死后应照常生成（stderr: ${r.stderr}）`);
      assert.ok(r.stderr.includes("[T5-net-block] 全程零出网连接"), "封网预加载确实在位");
    }
    const cv = await readFile(join(work, "cv-general-v1.docx"));
    const letter = await readFile(join(work, "cover_letter-general-v1.docx"));
    assert.ok(reopenDocument(cv).includes("王某某"), "封网下产出的简历可重开且内容完整");
    assert.ok(reopenDocument(letter).length > 0, "封网下产出的求职信可重开");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("PRD150/T5-1c · socket 封死后 docx-apply-demo（npm→node 子进程链）仍照常产出", () => {
  const work = join(tmpdir(), `brain27-t5-demo-${process.pid}`);
  // NODE_OPTIONS 让 npm 及其 node 子进程一并加载封网预加载（整条链零出网）
  const r = spawnSync(process.execPath,
    [...NET_BLOCK_ARGS, APPLY_DEMO, "--out", work],
    { encoding: "utf-8", cwd: REPO, env: { ...process.env, NODE_OPTIONS: `--import ${NET_BLOCK}` } });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok((r.stderr.match(/\[T5-net-block\] 全程零出网连接/g) ?? []).length >= 2,
    "demo 自身与子进程链都加载了封网预加载");
  const product = join(work, "cover_letter-opp-demo-2026-042-v1.docx");
  const bytes = spawnSync("node", ["-e",
    `process.stdout.write(require("fs").readFileSync(${JSON.stringify(product)}).toString("base64"))`],
    { encoding: "buffer" });
  const document = reopenDocument(Buffer.from(bytes.stdout.toString(), "base64"));
  assert.ok(document.includes("具身智能算法实习"), "封网下产物内容完整（信头岗位）");
  rm(work, { recursive: true, force: true });
});

// ── ② 两模板样例 .docx 重开断言合格 ────────────────────────────

test("PRD150/T5-2a · resume 样例 .docx 重开：段落结构 / 内容 / AI 标注段合格", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-t5-resume-"));
  try {
    const r = await runNode(["--experimental-strip-types", GENERATE,
      "--template", "resume", "--profile", SAMPLE_PROFILE, "--out", work]);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(!r.stdout.includes("⚠️"), "样例档案必选字段齐全，无占位符警告");

    const document = reopenDocument(await readFile(join(work, "cv-general-v1.docx")));
    // 段落结构：真实文档段落（w:p）与文本段（w:t）数量下限（渲染器一段一 run，按段计）
    assert.ok((document.match(/<w:p[ >]/g) ?? []).length >= 10, "段落数下限");
    assert.ok((document.match(/<w:t[ >]/g) ?? []).length >= 8, "文本段数下限");
    // 内容：姓名 / 教育 / 技能（含等级标注）
    assert.ok(document.includes("王某某"), "姓名行");
    assert.ok(document.includes("某大学心理与认知科学学院"), "教育区块");
    assert.ok(document.includes("Python（熟练）"), "技能区块（等级标注）");
    // 可选字段空槽：样例故意留空 phone 与 outputs，联系行跳过、成果区块整块省略
    assert.ok(!document.includes("[待填写："), "无占位符残留");
    assert.ok(!document.includes("电话"), "空 phone 槽跳过不留痕");
    // AI 标注段：非 final 默认携带，独立样式 ai-draft-marker
    assert.ok(document.includes(AI_DRAFT_MARKER), "AI 标注段文案");
    assert.ok(document.includes('w:val="ai-draft-marker"'), "AI 标注段独立样式");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("PRD150/T5-2b · cover-letter 样例 .docx 重开：占位符入文 / 草稿消费 / AI 标注；--final 消除标注", async () => {
  const work = await mkdtemp(join(tmpdir(), "brain27-t5-letter-"));
  try {
    const runLetter = (extra) => runNode(["--experimental-strip-types", GENERATE,
      "--template", "cover-letter",
      "--profile", join(APPLY_SAMPLE, "profile.json"),
      "--opportunity", join(APPLY_SAMPLE, "opportunity.json"),
      "--letter-draft", join(APPLY_SAMPLE, "letter-draft.md"),
      "--out", work, "--version", extra.includes("--final") ? "2" : "1", ...extra]);

    const r = await runLetter([]);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const document = reopenDocument(await readFile(join(work, "cover_letter-general-v1.docx")));
    assert.ok((document.match(/<w:p[ >]/g) ?? []).length >= 8, "段落数下限");
    // 信头与来意段：机会公开情报注入（样例故意缺 target.researchInterests → 占位符入文）
    assert.ok(document.includes("具身智能算法实习（虚构岗位）"), "信头岗位");
    assert.ok(document.includes("示例研究院"), "收件机构");
    assert.ok(document.includes("[待填写：target.researchInterests]"), "缺失必选字段占位符入文");
    // 匹配段：草稿正文消费、头部 ⚠️ 标注块剥除（docx 内不复用 Markdown 标记）
    assert.ok(document.includes("我对仿真到真机迁移方向"), "匹配段草稿正文");
    assert.ok(!document.includes("&gt; ⚠️") && !document.includes("> ⚠️"), "草稿头部标注块已剥除");
    // AI 标注段：默认携带
    assert.ok(document.includes(AI_DRAFT_MARKER), "默认带 AI 标注段");

    // --final：人工定稿版无 AI 标注段
    const rf = await runLetter(["--final"]);
    assert.equal(rf.code, 0, `stderr: ${rf.stderr}`);
    const finalDoc = reopenDocument(await readFile(join(work, "cover_letter-general-v2.docx")));
    assert.ok(!finalDoc.includes(AI_DRAFT_MARKER), "--final 不带 AI 标注段");
    assert.ok(finalDoc.includes("[待填写：target.researchInterests]"), "终稿仍保留待填占位符（诚实呈现）");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

// ── ③ examples/ 与 docs/ 样例隐私扫描 ─────────────────────────

const SCAN_TEXT_EXT = new Set([".md", ".json", ".txt", ".sql", ".mjs", ".html", ".yaml", ".yml"]);
/** 隐私红线豁免（显式登记，防扫描形同虚设）：仓库主自有账户名，历史运维记录、非样例数据。 */
const EMAIL_BASELINE_ALLOWLIST = new Set(["zhanglu.net@gmail.com"]);
const EXAMPLE_DOMAIN = /(^|\.)example\.(com|net|org|dev)$|(^|\.)[a-z0-9-]+\.(example|invalid|test|localhost)$/i; // RFC 2606 保留域全集（.example/.invalid/.test/.localhost 及 example.com/net/org/dev 子域）——保留域不可能持有真实邮箱
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;             // 大陆手机号
const ID_CARD_RE = /(?<![0-9Xx])\d{17}[\dXx](?![0-9Xx])/; // 18 位身份证号

async function walkTextFiles(rootRel, out) {
  const root = join(REPO, rootRel);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) await walkTextFiles(relative(REPO, p), out);
    else if (SCAN_TEXT_EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

test("PRD150/T5-3 · examples/ 与 docs/ 隐私扫描：非 example 域邮箱 / 手机号 / 身份证号零命中", async () => {
  const files = [
    ...(await walkTextFiles("examples", [])),
    ...(await walkTextFiles("docs", [])),
  ];
  assert.ok(files.length >= 10, `扫描应覆盖两个目录（实际 ${files.length} 个文本文件）`);

  for (const p of files) {
    const rel = relative(REPO, p);
    const text = await readFile(p, "utf-8");
    for (const email of text.match(EMAIL_RE) ?? []) {
      const domain = email.split("@")[1] ?? "";
      const allowed = EXAMPLE_DOMAIN.test(domain) || EMAIL_BASELINE_ALLOWLIST.has(email.toLowerCase());
      assert.ok(allowed, `${rel}: 非 example.* 域邮箱（真实隐私嫌疑）：${email}`);
    }
    assert.ok(!PHONE_RE.test(text), `${rel}: 疑似大陆手机号：${text.match(PHONE_RE)?.[0]}`);
    assert.ok(!ID_CARD_RE.test(text), `${rel}: 疑似 18 位身份证号：${text.match(ID_CARD_RE)?.[0]}`);
  }
});
