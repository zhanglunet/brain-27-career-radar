/** multipart 文件上传读取与简历类型识别。 */
import { HttpError } from "./http.ts";

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type ResumeMime = typeof PDF_MIME | typeof DOCX_MIME;

const MULTIPART_OVERHEAD = 16_384;

export async function readUpload(
  request: Request,
  field: string,
  maxBytes: number,
): Promise<{ filename: string; mime: string; bytes: Uint8Array }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes + MULTIPART_OVERHEAD) throw new HttpError(413, "文件不能超过 5 MB");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "没有收到文件");
  }
  const file = form.get(field);
  if (!file || typeof file === "string") throw new HttpError(400, "没有收到文件");
  if (file.size > maxBytes) throw new HttpError(413, "文件不能超过 5 MB");
  return { filename: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

/** 只认文件头，不信浏览器给的类型；DOCX 另要求扩展名，避免把任意 zip 当简历。 */
export function sniffResumeType(bytes: Uint8Array, filename: string): ResumeMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF_MIME;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && filename.toLowerCase().endsWith(".docx")) return DOCX_MIME;
  return null;
}

/** 仅用于页面展示的文件名：去路径、去控制字符、截断到 100 字。 */
export function displayFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return [...(cleaned || "简历")].slice(0, 100).join("");
}
