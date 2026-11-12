/** 私有平台请求入口：主机与来源校验 → 路由分发 → 统一错误页与安全头。 */
import { verifyAccessJwt } from "./access.ts";
import type { Ctx, Route } from "./context.ts";
import type { Deps, PlatformEnv } from "./env.ts";
import { HttpError, html, isAllowedHost, isAllowedOrigin, logEvent, redirect, text, withSecurityHeaders } from "./http.ts";
import { routes as adminRoutes } from "./routes/admin-routes.ts";
import { routes as appRoutes } from "./routes/app-routes.ts";
import { routes as authRoutes } from "./routes/auth-routes.ts";
import { messagePage } from "./views.ts";

const ROUTES: Route[] = [...authRoutes, ...appRoutes, ...adminRoutes];

const ROBOTS = "User-agent: *\nDisallow: /\n";

/** 配置了 ACCESS_AUD 时，/admin 路径必须带合法的 Cloudflare Access JWT（缺配置一律拒绝）。 */
async function checkAdminAccess(ctx: Ctx): Promise<void> {
  if (!ctx.env.ACCESS_AUD || !/^\/admin(\/|$)/.test(ctx.url.pathname)) return;
  const token = ctx.request.headers.get("cf-access-jwt-assertion");
  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud } = ctx.env;
  const fetchJwks = ctx.deps.fetchJwks;
  const ok = Boolean(token && teamDomain && fetchJwks)
    && (await verifyAccessJwt(token as string, { teamDomain: teamDomain as string, aud, now: ctx.deps.now(), fetchJwks: fetchJwks as (url: string) => Promise<unknown> }));
  if (!ok) throw new HttpError(403, "没有权限");
}

async function dispatch(ctx: Ctx): Promise<Response> {
  await checkAdminAccess(ctx);
  const method = ctx.request.method === "HEAD" ? "GET" : ctx.request.method;
  if (method === "GET" && ctx.url.pathname === "/robots.txt") return text(ROBOTS);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(ctx.url.pathname);
    if (match) return route.handler(ctx, match.slice(1));
  }
  throw new HttpError(404, "页面不存在");
}

function errorResponse(error: HttpError): Response {
  if (error.location) return redirect(error.location);
  const title = error.status === 404 ? "页面不存在" : error.status === 403 ? "没有权限" : "请求无法完成";
  return html(messagePage(title, error.message, null, "error"), error.status);
}

export async function handleRequest(request: Request, env: PlatformEnv, deps: Deps): Promise<Response> {
  if (!isAllowedHost(request, env)) return withSecurityHeaders(text("Not found", 404));
  if (!isAllowedOrigin(request, env)) return withSecurityHeaders(text("Forbidden", 403));
  const ctx: Ctx = { request, env, deps, url: new URL(request.url) };
  let response: Response;
  try {
    response = await dispatch(ctx);
  } catch (error) {
    if (error instanceof HttpError) {
      response = errorResponse(error);
    } else {
      logEvent("platform.error", { route: ctx.url.pathname, reason: error instanceof Error ? error.name : "unknown" });
      response = html(messagePage("出错了", "服务暂时出错，请稍后再试。", null, "error"), 500);
    }
  }
  if (request.method === "HEAD") response = new Response(null, { status: response.status, headers: response.headers });
  return withSecurityHeaders(response);
}
