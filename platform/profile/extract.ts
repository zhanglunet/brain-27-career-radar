/** 简历转文本：经 Workers AI toMarkdown，在 Cloudflare 内完成，不把用户文件名交给转换服务。 */
import type { ResumeConverter } from "../env.ts";
import { PDF_MIME } from "../upload.ts";

export const RESUME_TEXT_MAX_CHARS = 20_000;

export class ExtractError extends Error {}

/** toMarkdown 会在开头加 `# resume.pdf` 标题，PDF 还会附 `## Metadata` 段与 `## Contents` 标题；这些不属于简历内容。 */
function stripConverterHeader(markdown: string): string {
  let text = markdown.replace(/^#\s+resume\.(pdf|docx)\s*\n/, "");
  const contents = text.match(/^## Metadata\n[\s\S]*?^## Contents\s*\n/m);
  if (contents && contents.index === 0) text = text.slice(contents[0].length);
  return text;
}

export async function extractResumeText(
  ai: ResumeConverter,
  file: { bytes: Uint8Array; filename: string; mime: string },
): Promise<string> {
  const name = file.mime === PDF_MIME ? "resume.pdf" : "resume.docx";
  let result;
  try {
    result = await ai.toMarkdown({ name, blob: new Blob([file.bytes as BlobPart], { type: file.mime }) });
  } catch {
    throw new ExtractError("无法读取简历内容，请确认文件没有加密或损坏");
  }
  if (result.format !== "markdown") throw new ExtractError("无法读取简历内容，请确认文件没有加密或损坏");
  const text = stripConverterHeader(result.data.replace(/\r\n/g, "\n")).replace(/\n{3,}/g, "\n\n").trim();
  if (!text.replace(/\s/g, "")) throw new ExtractError("简历里没有读到文字，可能是扫描件，请改用文字版或直接写意向描述");
  return [...text].slice(0, RESUME_TEXT_MAX_CHARS).join("");
}
