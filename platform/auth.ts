/** 会话解析与权限守卫。 */
import { CONSENT_VERSION } from "./consent.ts";
import type { Ctx } from "./context.ts";
import { hasConsent } from "./data/consents.ts";
import { findSessionUser } from "./data/sessions.ts";
import type { User } from "./data/tables.ts";
import { HttpError, SESSION_COOKIE, parseCookies } from "./http.ts";

export function sessionToken(ctx: Ctx): string | null {
  return parseCookies(ctx.request.headers.get("cookie"))[SESSION_COOKIE] || null;
}

export async function currentUser(ctx: Ctx): Promise<User | null> {
  const token = sessionToken(ctx);
  if (!token) return null;
  return findSessionUser(ctx.env.PRIVATE_DB, token, ctx.deps.now());
}

export async function requireUser(ctx: Ctx): Promise<User> {
  const user = await currentUser(ctx);
  if (!user) throw new HttpError(303, "请先登录", "/login");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<User> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new HttpError(403, "没有权限");
  return user;
}

export async function requireConsent(ctx: Ctx, user: User): Promise<void> {
  if (!(await hasConsent(ctx.env.PRIVATE_DB, user.id, CONSENT_VERSION))) throw new HttpError(303, "请先阅读并同意数据条款", "/consent");
}
