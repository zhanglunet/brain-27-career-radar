/**
 * PRD-150/T4：申请助手流程对接端到端测试（trend #753）。
 * 申请草稿三件套（虚构）→ demo 脚本 → 真实 .docx 产物重开断言。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 最小 ZIP 读取（与 tests/local-apply-docx-cli.test.mjs 同款）：取 document.xml 文本。 */
function readDocumentXml(docxPath) {
  const buf = readFileSync(docxPath);
  const sig = 0x04034b50;
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== sig) { off += 1; continue; }
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString("utf-8");
    const dataStart = off + 30 + nameLen + extraLen;
    if (name === "word/document.xml") {
      const data = buf.subarray(dataStart, dataStart + compSize);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf-8");
    }
    off = dataStart + compSize;
  }
  throw new Error("word/document.xml not found");
}

test("申请草稿三件套 → 求职信 .docx 端到端", () => {
  const outDir = mkdtempSync(join(tmpdir(), "brain27-apply-demo-"));
  const run = spawnSync(
    "node", [join(REPO, "scripts", "docx-apply-demo.mjs"), "--out", join(outDir, "apply-demo")],
    { encoding: "utf-8" });
  assert.equal(run.status, 0, `demo 失败：${run.stderr}`);
  const product = join(outDir, "apply-demo", "cover_letter-opp-demo-2026-042-v1.docx");
  assert.ok(existsSync(product), "产物 .docx 未落盘");
  assert.ok(statSync(product).size > 8_000, "产物体积异常（疑似空文档）");
  const xml = readDocumentXml(product);
  // 虚构样例的关键内容进文：岗位/机构来自机会 JSON，匹配段草稿文本入正文
  assert.ok(xml.includes("具身智能算法实习"), "岗位标题未入文");
  assert.ok(xml.includes("示例研究院"), "机构未入文");
  assert.ok(xml.includes("域随机化"), "匹配段草稿文本未入文");
  assert.ok(xml.includes("AI 草稿"), "AI_DRAFT_MARKER 标注段未入文");
});

test("样例三件套字段形状与申请助手产物对齐", async () => {
  const { readFileSync: rf } = await import("node:fs");
  const opp = JSON.parse(rf(join(REPO, "examples/apply-draft-sample/opportunity.json"), "utf-8"));
  for (const key of ["id", "title", "org", "type"]) {
    assert.equal(typeof opp[key], "string", `opportunity.${key} 缺失`);
  }
  const profile = JSON.parse(rf(join(REPO, "examples/apply-draft-sample/profile.json"), "utf-8"));
  for (const key of ["education", "experience", "skills", "interests"]) {
    assert.ok(Array.isArray(profile[key]), `profile.${key} 须为数组`);
  }
  const draft = rf(join(REPO, "examples/apply-draft-sample/letter-draft.md"), "utf-8");
  assert.ok(draft.includes("AI 草稿，需人工改写"), "草稿须带 AI_DRAFT_MARKER");
});
