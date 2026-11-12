import assert from "node:assert/strict";
import test from "node:test";
import { ExtractError, extractResumeText } from "../platform/profile/extract.ts";
import { fakeAi } from "./helpers/platform-client.mjs";

const file = (overrides = {}) => ({ bytes: new TextEncoder().encode("%PDF- 内容"), filename: "我的简历(最终版).pdf", mime: "application/pdf", ...overrides });

test("调用 toMarkdown 并返回文本", async () => {
  const ai = fakeAi(() => ({ format: "markdown", data: "# 张三（示例）\n\n示例大学 硕士" }));
  assert.equal(await extractResumeText(ai, file()), "# 张三（示例）\n\n示例大学 硕士");
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].blob.type, "application/pdf");
});

test("文件名规整，不把用户文件名传给转换服务", async () => {
  const ai = fakeAi(() => ({ format: "markdown", data: "x" }));
  await extractResumeText(ai, file());
  await extractResumeText(ai, file({ filename: "cv.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.deepEqual(ai.calls.map((call) => call.name), ["resume.pdf", "resume.docx"]);
});

test("转换失败或抛错 → ExtractError", async () => {
  for (const handler of [() => ({ format: "error", error: "bad" }), () => { throw new Error("boom"); }]) {
    await assert.rejects(() => extractResumeText(fakeAi(handler), file()), (error) => error instanceof ExtractError && /无法读取简历内容/.test(error.message));
  }
});

test("空结果 → 提示可能是扫描件", async () => {
  await assert.rejects(
    () => extractResumeText(fakeAi(() => ({ format: "markdown", data: " \n\n \n" })), file()),
    (error) => error instanceof ExtractError && /扫描件/.test(error.message),
  );
});

test("去掉多余空行，超长结果截断到 20000 字", async () => {
  assert.equal(await extractResumeText(fakeAi(() => ({ format: "markdown", data: "a\n\n\n\n\nb" })), file()), "a\n\nb");
  const long = await extractResumeText(fakeAi(() => ({ format: "markdown", data: "字".repeat(25000) })), file());
  assert.equal([...long].length, 20000);
});

test("去掉转换服务加的文件名标题与 PDF 元数据段（实测 toMarkdown 的输出形态）", async () => {
  const pdfOutput = "# resume.pdf\n## Metadata\n- PDFFormatVersion=1.4\n- IsLinearized=false\n\n\n\n## Contents\n### Page 1\nSample Candidate - Example University";
  const docxOutput = "# resume.docx\n\nSample Candidate\n\nExample University";
  assert.equal(await extractResumeText(fakeAi(() => ({ format: "markdown", data: pdfOutput })), file()), "### Page 1\nSample Candidate - Example University");
  assert.equal(await extractResumeText(fakeAi(() => ({ format: "markdown", data: docxOutput })), file()), "Sample Candidate\n\nExample University");
});
