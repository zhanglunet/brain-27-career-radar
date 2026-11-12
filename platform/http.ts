/** 私有平台的 HTTP 基础件：安全头、cookie、主机与来源校验、表单读取、日志白名单。 */
import type { PlatformEnv } from "./env.ts";

export const SESSION_COOKIE = "__Host-session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const MAX_BODY_BYTES = 65_536;

export class HttpError extends Error {
  status: number;
  location?: string;

  constructor(status: number, message: string, location?: string) {
    super(message);
    this.status = status;
    this.location = location;
  }
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

export function jsonDownload(data: unknown, filename: string): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function platformHost(env: Pick<PlatformEnv, "PLATFORM_HOST">): string {
  return env.PLATFORM_HOST.trim().toLowerCase();
}

function isLocalDevHost(host: string): boolean {
  return host.endsWith(".localhost");
}

export function isAllowedHost(request: Request, env: Pick<PlatformEnv, "PLATFORM_HOST">): boolean {
  return new URL(request.url).hostname.toLowerCase() === platformHost(env);
}

export function isAllowedOrigin(request: Request, env: Pick<PlatformEnv, "PLATFORM_HOST">): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = platformHost(env);
  if (origin === `https://${host}`) return true;
  if (!isLocalDevHost(host)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === host && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "提交内容过大");
  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "提交内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LOG_FIELDS = new Set(["userId", "targetUserId", "route", "status", "count", "reason"]);

/** 只记录白名单字段；邮箱、密码、令牌、表单内容一律不进日志。 */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (LOG_FIELDS.has(key)) kept[key] = value;
  }
  console.log(JSON.stringify({ event, ...kept }));
}
