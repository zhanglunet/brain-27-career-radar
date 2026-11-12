/** 用户页面：知情同意、意向目标、账号导出与删除。 */
import { requireConsent, requireUser } from "../auth.ts";
import { CONSENT_POINTS, CONSENT_VERSION } from "../consent.ts";
import type { Route } from "../context.ts";
import { verifyPassword } from "../crypto.ts";
import { audit, countActiveAdmins, findPasswordHash } from "../data/accounts.ts";
import { recordConsent } from "../data/consents.ts";
import { eraseUser } from "../data/erase.ts";
import { forUser } from "../data/scoped.ts";
import type { User } from "../data/tables.ts";
import type { GoalTarget } from "../profile/schema.ts";
import { HttpError, clearSessionCookie, escapeHtml, html, jsonDownload, logEvent, readForm, redirect } from "../http.ts";
import { layout, notice } from "../views.ts";

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 4000;

const length = (value: string) => [...value].length;

function targetSummary(target: GoalTarget | null): string {
  if (!target) return `<p class="muted">还没有确认目标画像。可以在"我的档案"里让智能体根据这个目标整理。</p>`;
  const rows: [string, string][] = [
    ["类型", target.kinds.join("、")],
    ["方向", target.directions.join("、")],
    ["城市", target.cities.join("、")],
    ["时间", target.timing ?? ""],
    ["其他", target.notes ?? ""],
  ];
  return `<table>${rows.filter(([, value]) => value).map(([label, value]) => `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

async function homePage(db: D1Database, user: User, message = "", status = 200): Promise<Response> {
  const goals = await forUser(db, user.id).goals.list();
  const list = goals.length
    ? `<ul class="cards">${goals.map((goal) => `<li><strong>${escapeHtml(goal.title)}</strong><p>${escapeHtml(goal.description)}</p>${targetSummary(goal.target)}
<p><a href="/goals/${encodeURIComponent(goal.id)}">查看机会</a></p>
<form method="post" action="/goals/${encodeURIComponent(goal.id)}/delete" style="margin:0"><button class="link" type="submit">删除</button></form></li>`).join("")}</ul>`
    : `<p class="muted">还没有目标。用一段话描述你想找什么样的机会，比如方向、岗位类型、城市和时间。</p>`;
  const body = `<h1>我的目标</h1>${message ? notice(message, "error") : ""}${list}
<h2>新增目标</h2>
<form method="post" action="/goals">
<label>标题<input name="title" required maxlength="${TITLE_MAX}" placeholder="例如：国内校招"></label>
<label>描述<textarea name="description" required maxlength="${DESCRIPTION_MAX}" placeholder="方向、岗位或项目类型、城市、届别或入学时间、其他要求"></textarea></label>
<button type="submit">保存目标</button></form>`;
  return html(layout("我的目标", body, user), status);
}

function consentPage(user: User, message = "", status = 200): Response {
  const body = `<h1>数据条款（${CONSENT_VERSION}）</h1>${message ? notice(message, "error") : ""}
<p>使用智能体功能前，请阅读以下说明：</p><ul>${CONSENT_POINTS.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
<form method="post" action="/consent"><input type="hidden" name="version" value="${CONSENT_VERSION}"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="agree" value="yes" style="width:auto" required>我已阅读并同意以上条款</label><button type="submit">同意并继续</button></form>`;
  return html(layout("数据条款", body, user), status);
}

function accountPage(user: User, message = "", status = 200): Response {
  const body = `<h1>账号</h1>${message ? notice(message, "error") : ""}
<table><tr><th>邮箱</th><td>${escapeHtml(user.email)}</td></tr><tr><th>角色</th><td>${user.role === "admin" ? "管理员" : "用户"}</td></tr></table>
<h2>导出数据</h2><p><a href="/account/export">下载我的全部数据（JSON）</a></p>
<h2>删除账号</h2><p class="muted">删除后你的账号、目标和同意记录会立即从数据库移除；数据库备份在保留期内仍可能含有这些数据。此操作不可撤销。</p>
<form method="post" action="/account/delete"><label>输入密码确认<input name="password" type="password" required autocomplete="current-password"></label><button class="danger" type="submit">永久删除我的账号</button></form>`;
  return html(layout("账号", body, user), status);
}

export const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/consent$/,
    async handler(ctx) {
      return consentPage(await requireUser(ctx));
    },
  },
  {
    method: "POST",
    pattern: /^\/consent$/,
    async handler(ctx) {
      const user = await requireUser(ctx);
      const form = await readForm(ctx.request);
      // 只记录用户实际看到的那一版条款：页面加载后条款若已升级，必须重新阅读。
      if (form.get("version") !== CONSENT_VERSION) return consentPage(user, "条款已更新，请阅读最新条款后再同意。", 409);
      if (form.get("agree") !== "yes") return consentPage(user, "请勾选同意后再继续。", 400);
      await recordConsent(ctx.env.PRIVATE_DB, user.id, CONSENT_VERSION, ctx.deps.now());
      logEvent("platform.consent", { userId: user.id, status: CONSENT_VERSION });
      return redirect("/");
    },
  },
  {
    method: "GET",
    pattern: /^\/$/,
    async handler(ctx) {
      const user = await requireUser(ctx);
      await requireConsent(ctx, user);
      return homePage(ctx.env.PRIVATE_DB, user);
    },
  },
  {
    method: "POST",
    pattern: /^\/goals$/,
    async handler(ctx) {
      const user = await requireUser(ctx);
      await requireConsent(ctx, user);
      const form = await readForm(ctx.request);
      const title = (form.get("title") ?? "").trim();
      const description = (form.get("description") ?? "").trim();
      if (!title || length(title) > TITLE_MAX) return homePage(ctx.env.PRIVATE_DB, user, `标题需为 1–${TITLE_MAX} 个字。`, 400);
      if (!description || length(description) > DESCRIPTION_MAX) return homePage(ctx.env.PRIVATE_DB, user, `描述需为 1–${DESCRIPTION_MAX} 个字。`, 400);
      await forUser(ctx.env.PRIVATE_DB, user.id).goals.create({ title, description }, ctx.deps.now());
      return redirect("/");
    },
  },
  {
    method: "POST",
    pattern: /^\/goals\/([0-9a-f-]+)\/delete$/,
    async handler(ctx, [goalId]) {
      const user = await requireUser(ctx);
      await requireConsent(ctx, user);
      if (!(await forUser(ctx.env.PRIVATE_DB, user.id).goals.remove(goalId))) throw new HttpError(404, "目标不存在");
      return redirect("/");
    },
  },
  {
    method: "GET",
    pattern: /^\/account$/,
    async handler(ctx) {
      return accountPage(await requireUser(ctx));
    },
  },
  {
    method: "GET",
    pattern: /^\/account\/export$/,
    async handler(ctx) {
      const user = await requireUser(ctx);
      const data = await forUser(ctx.env.PRIVATE_DB, user.id).exportAll(ctx.deps.now());
      logEvent("platform.account.export", { userId: user.id });
      return jsonDownload(data, "export.json");
    },
  },
  {
    method: "POST",
    pattern: /^\/account\/delete$/,
    async handler(ctx) {
      const db = ctx.env.PRIVATE_DB;
      const user = await requireUser(ctx);
      const password = (await readForm(ctx.request)).get("password") ?? "";
      const stored = await findPasswordHash(db, user.id);
      if (!stored || !(await verifyPassword(password, stored))) return accountPage(user, "密码不正确。", 400);
      if (user.role === "admin" && (await countActiveAdmins(db)) <= 1) return accountPage(user, "不能删除唯一的管理员账号。", 400);
      await eraseUser(ctx.env, user.id);
      await audit(db, { actorUserId: user.id, action: "account.delete", targetUserId: user.id }, ctx.deps.now());
      logEvent("platform.account.delete", { userId: user.id });
      return redirect("/login", clearSessionCookie());
    },
  },
];
