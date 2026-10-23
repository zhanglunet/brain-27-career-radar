/**
 * PRD-150/T2 · 本地 .docx 生成测试（trend #751）。
 *
 * 验收：产出可打开的真实 .docx——用 node:zlib 手写的最小 ZIP 读取器
 * 重开产物（不引入测试专用依赖），断言段落/占位符/标注段/页脚。
 * 样例数据全部虚构（T1 §3.1 纪律），与 examples/doc-profile.sample.json 同源。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import { AI_DRAFT_MARKER } from "../lib/local-apply/drafter.ts";
import { parseJobDocProfile } from "../lib/local-apply/docx/profile.ts";
import { scanPlaceholders } from "../lib/local-apply/docx/placeholder.ts";
import { formatCnDate, renderJobDoc, writeRenderedDoc } from "../lib/local-apply/docx/render.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 最小 ZIP 读取器（仅测试用：定位 EOCD → 中央目录 → 本地头 → 解压）──

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

/** 重开 .docx：返回 { document, styles, footer } 三个关键 XML 文本。 */
function reopenDocx(bytes) {
  assert.ok(bytes.length > 0, "docx bytes empty");
  assert.equal(bytes[0], 0x50, "zip magic P");
  assert.equal(bytes[1], 0x4b, "zip magic K");
  const entries = readZipEntries(bytes);
  const doc = entries["word/document.xml"]?.toString("utf8") ?? "";
  const styles = entries["word/styles.xml"]?.toString("utf8") ?? "";
  const footerKey = Object.keys(entries).find((k) => /^word\/footer\d+\.xml$/.test(k));
  const footer = footerKey ? entries[footerKey].toString("utf8") : "";
  assert.ok(doc.length > 0, "word/document.xml missing");
  assert.ok(styles.length > 0, "word/styles.xml missing");
  return { document: doc, styles, footer };
}

// ── 虚构样例（与 examples/doc-profile.sample.json 同源；phone/outputs 留空）──

const SAMPLE = JSON.parse(
  await readFile(join(HERE, "../examples/doc-profile.sample.json"), "utf-8"),
);

const SAMPLE_OPPORTUNITY = {
  id: "opp-sample-001",
  title: "脑机接口方向博士项目（虚构示例）",
  org: "某大学",
  type: "phd",
  region: "英国",
  deadline: "2026-12-15",
  keywords: ["EEG", "Python", "脑机接口"],
  mentors: ["某教授（示例）"],
  description: "虚构示例机会，仅用于测试",
};

const SAMPLE_LETTER_DRAFT = [
  "> ⚠️ AI 草稿，需人工改写",
  "> 本稿由本地规则引擎生成（模板 + 规则，v0.1），未经人工审阅不得直接发送。",
  "",
  "我近期围绕脑机接口完成了 EEG 信号处理管线的搭建（虚构示例），",
  "希望在贵校继续深入该方向的研究计划（虚构示例）。",
].join("\n");

const FIXED_NOW = new Date(2026, 9, 23); // 2026-10-23

test("PRD150/T2-1 · 样例档案渲染 resume 为真实 .docx（重开断言 + 空槽跳过）", async () => {
  const result = await renderJobDoc({
    template: "resume",
    opportunityId: "opp-sample-001",
    version: 1,
    profile: parseJobDocProfile(SAMPLE),
    now: FIXED_NOW,
  });

  // 文件名版本约定（T1 §4.3）：{kind}-{opportunity_id}-v{version}.docx
  assert.equal(result.template, "resume");
  assert.equal(result.kind, "cv");
  assert.equal(result.filename, "cv-opp-sample-001-v1.docx");

  const { document, styles, footer } = reopenDocx(result.bytes);

  // 六区块内容（T1 §3.3 占位样例渲染节选）
  assert.ok(document.includes("王某某"), "姓名行");
  assert.ok(document.includes("某大学心理与认知科学学院"), "教育·学校");
  assert.ok(document.includes("实验心理学硕士"), "教育·学位");
  assert.ok(document.includes("2024.09 – 2027.06（预计）"), "教育·时段");
  assert.ok(document.includes("科研助理 @ 某脑科学研究所"), "经历·title @ org");
  assert.ok(document.includes("用 Python 处理 64 导 EEG 数据，复现××效应（示例）"), "经历·highlight");
  assert.ok(document.includes("EEG 信号处理、Python（熟练）、Matlab"), "技能顿号连接（含对象形态）");
  assert.ok(document.includes("教育背景") && document.includes("研究经历") && document.includes("技能"), "区块标题");

  // 空槽跳过：phone 留空 → 联系行自动少一段，分隔符不残留（T1 §2.2）
  assert.ok(
    document.includes("wang@example.com · 上海 · https://wang.example.dev"),
    "联系行 = email · location · homepage",
  );
  assert.ok(!document.includes(" · · "), "无连续分隔符");
  assert.ok(!document.includes("138-0000"), "phone 未渲染");

  // outputs 留空 → 成果区块整块省略（含区块标题）
  assert.ok(!document.includes("成果"), "outputs 空则区块省略");

  // 样例档案字段齐全 → 无占位符残留、无警告
  assert.deepEqual(result.placeholders, []);
  assert.deepEqual(result.warnings, []);

  // AI 标注段：首行独立段、样式名 ai-draft-marker、斜体/灰色（T1 §3.3）
  assert.ok(document.includes(AI_DRAFT_MARKER), "标注段文字");
  assert.ok(styles.includes('w:styleId="ai-draft-marker"'), "标注段样式名");
  assert.ok(styles.includes("<w:i/>") || styles.includes("<w:i "), "斜体");
  assert.ok(styles.includes("808080"), "灰色");

  // 中文排版约定（T1 §2.4）：East Asia 字体回退栈 + A4 页边距
  assert.ok(styles.includes('w:eastAsia="黑体"') && styles.includes('w:eastAsia="宋体"'), "字体回退栈");
  assert.ok(document.includes('w:w="11906"'), "A4 宽");

  // 页脚 x / y 页码
  assert.ok(footer.includes("页") && (footer.includes("NUMPAGES") || footer.includes("PAGE")), "页脚页码");
});

test("PRD150/T2-2 · 空档案：必选字段留 [待填写] 占位符，渲染不中断", async () => {
  const result = await renderJobDoc({
    template: "resume",
    opportunityId: "general",
    version: 1,
    profile: {},
    now: FIXED_NOW,
  });
  const { document } = reopenDocx(result.bytes);
  for (const path of ["basics.name", "education", "experience", "skills"]) {
    assert.ok(document.includes(`[待填写：${path}]`), `占位符 ${path}`);
  }
  assert.deepEqual(result.placeholders, ["basics.name", "education", "experience", "skills"]);
  assert.equal(result.warnings.length, 4);
  assert.ok(result.warnings[0].includes("[待填写：basics.name]"), "警告文案含占位符");
  // scanPlaceholders 与渲染产物一致（后续 docx check 子命令复用）
  assert.deepEqual(scanPlaceholders(document), result.placeholders);
});

test("PRD150/T2-3 · cover-letter：机会注入 + 匹配段草稿 + 标注段强制/终稿去除", async () => {
  const render = async (final) =>
    renderJobDoc({
      template: "cover-letter",
      opportunityId: "opp-sample-001",
      version: 2,
      profile: parseJobDocProfile(SAMPLE),
      opportunity: SAMPLE_OPPORTUNITY,
      letterDraft: SAMPLE_LETTER_DRAFT,
      final,
      now: FIXED_NOW,
    });

  const draft = await render(undefined); // final 缺省 false：非 final 强制带标注
  assert.equal(draft.kind, "cover_letter");
  assert.equal(draft.filename, "cover_letter-opp-sample-001-v2.docx");
  const { document } = reopenDocx(draft.bytes);

  // 信头/日期/收件/称呼（机会字段为公开情报，T1 §4.4）
  assert.ok(document.includes("王某某"), "信头姓名");
  assert.ok(document.includes(formatCnDate(FIXED_NOW)), "渲染日期 YYYY 年 M 月 D 日");
  assert.ok(document.includes("收件：某教授（示例）"), "收件人（导师）");
  assert.ok(document.includes("某大学"), "收件机构");
  assert.ok(document.includes("尊敬的某教授（示例）："), "称呼（导师兜底规则不触发）");

  // 来意段（机会 title/org 注入）
  assert.ok(document.includes("脑机接口方向博士项目（虚构示例）"), "来意段机会标题");
  assert.ok(document.includes("脑机接口、认知神经科学"), "研究兴趣（target.researchInterests）");

  // 匹配段：materials 草稿正文进文，Markdown 标注块被剥除（docx 层标注段双保险）
  assert.ok(document.includes("EEG 信号处理管线的搭建"), "匹配段草稿正文");
  assert.ok(!document.includes("本稿由本地规则引擎生成"), "草稿 Markdown 标注块已剥除");
  assert.ok(document.includes(AI_DRAFT_MARKER), "docx 层标注段强制写入");

  // 佐证段：关键词命中最高的经历（EEG/Python 命中 tags/highlight）
  assert.ok(document.includes("科研助理：用 Python 处理 64 导 EEG 数据"), "佐证段命中经历");

  // 结尾与落款
  assert.ok(document.includes("此致") && document.includes("敬礼"), "结尾敬语");
  assert.ok(document.includes("王某某"), "落款");

  // 终稿：--final 生成无标注版（T1 §3.3）
  const final = await render(true);
  const reopened = reopenDocx(final.bytes);
  assert.ok(!reopened.document.includes(AI_DRAFT_MARKER), "final 版无标注");
});

test("PRD150/T2-4 · 老档案平铺形状兼容解析 + outputs 有值时区块保留", async () => {
  // CliProfile 平铺形状（T1 §1.3 兼容映射）→ JobDocProfile
  const flat = parseJobDocProfile({
    name: "王某某",
    degree: "实验心理学硕士",
    researchInterests: ["脑机接口"],
    skills: ["Python"],
    experience: ["一句话经历（虚构示例）"],
  });
  assert.equal(flat.basics?.name, "王某某");
  assert.equal(flat.education?.[0]?.degree, "实验心理学硕士");
  assert.equal(flat.experience?.[0]?.highlight, "一句话经历（虚构示例）");
  assert.deepEqual(flat.target?.researchInterests, ["脑机接口"]);
  assert.deepEqual(flat.skills, ["Python"]);

  const result = await renderJobDoc({
    template: "resume",
    opportunityId: "general",
    version: 1,
    profile: {
      ...flat,
      outputs: [{ title: "《××注意机制的建模研究》（示例）", venue: "某学术会议 2026（示例）", year: "2026" }],
    },
    now: FIXED_NOW,
  });
  const { document } = reopenDocx(result.bytes);
  assert.ok(document.includes("一句话经历（虚构示例）"), "老一句话经历 → highlight");
  assert.ok(document.includes("[待填写：experience[0].title]"), "title 必选缺失留占位符");
  assert.ok(document.includes("成果"), "outputs 有值 → 区块保留");
  assert.ok(
    document.includes("《××注意机制的建模研究》（示例） · 某学术会议 2026（示例） · 2026"),
    "成果条目拼接",
  );
});

test("PRD150/T2-5 · 渲染产物落盘可再读（writeRenderedDoc → 磁盘重开）", async () => {
  const result = await renderJobDoc({
    template: "resume",
    opportunityId: "opp-sample-001",
    version: 1,
    profile: parseJobDocProfile(SAMPLE),
    now: FIXED_NOW,
  });
  const dir = await mkdtemp(join(tmpdir(), "brain27-docx-test-"));
  try {
    const outPath = await writeRenderedDoc(result, dir);
    assert.equal(outPath, join(dir, "cv-opp-sample-001-v1.docx"));
    const fromDisk = await readFile(outPath);
    const { document } = reopenDocx(fromDisk);
    assert.ok(document.includes("王某某"), "从磁盘重开仍可读到姓名");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── G23 断言扩展（T1 §五.1）：lib/local-apply/docx/ 不得出现 fetch/http import ──

const NETWORK_PATTERNS = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket(",
  "new WebSocket",
  "node:http",
  "node:https",
  "https.request",
  "http.request",
  "nodemailer",
  "sendmail",
  "smtp",
];

async function listDocxSources() {
  const root = join(HERE, "../lib/local-apply/docx");
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.endsWith(".ts")) out.push(p);
    }
  };
  await walk(root);
  return out;
}

test("PRD150/T2-6 · G23 扩展：docx 模块源码零网络调用、零日志、import 白名单", async () => {
  const files = await listDocxSources();
  assert.ok(files.length >= 5, `应覆盖 docx/ 全部源码（实际 ${files.length} 个）`);
  for (const path of files) {
    const text = await readFile(path, "utf-8");
    // 注释里的"禁止"声明不算——只查非注释行的真实调用（与验收2/5同一口径）
    const codeLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("*") && !l.startsWith("//") && !l.startsWith("/*"));
    for (const pat of NETWORK_PATTERNS) {
      const hits = codeLines.filter((l) => l.includes(pat));
      assert.equal(hits.length, 0, `${path} 不应含网络调用 ${pat}，命中: ${hits[0] ?? ""}`);
    }
    // 数据主权：无日志（个人内容不可能经由本模块外泄，与 drafter.ts 同一红线）
    assert.ok(!codeLines.some((l) => l.includes("console.")), `${path} 不应打日志`);
    // import 白名单：相对路径 / node: 内建 / 唯一渲染库 docx（纯本地 TS 库）
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const imp of imports) {
      assert.ok(
        imp.startsWith("./") || imp.startsWith("../") || imp.startsWith("node:") || imp === "docx",
        `${path} 非白名单 import: ${imp}`,
      );
    }
  }
});
