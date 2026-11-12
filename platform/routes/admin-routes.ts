/** 管理后台：审批、停用 / 启用、邀请码、重置链接。不提供查看用户私人内容的功能。 */
import { requireAdmin } from "../auth.ts";
import type { Ctx, Route } from "../context.ts";
import {
  audit,
  countActiveAdmins,
  createInvite,
  createResetToken,
  findUserById,
  listUsers,
  setUserStatus,
} from "../data/accounts.ts";
import { eraseUser } from "../data/erase.ts";
import { revokeUserSessions } from "../data/sessions.ts";
import type { User } from "../data/tables.ts";
import { HttpError, escapeHtml, html, logEvent, redirect } from "../http.ts";
import { layout, notice } from "../views.ts";

const STATUS_LABEL: Record<User["status"], string> = { pending: "待审批", active: "正常", disabled: "已停用" };

function actionButton(userId: string, action: string, label: string, danger = false): string {
  return `<form method="post" action="/admin/users/${encodeURIComponent(userId)}/${action}" style="margin:0;display:inline"><button class="${danger ? "danger" : "link"}" type="submit">${label}</button></form>`;
}

function userRow(user: User, admin: User): string {
  const actions = [
    user.status === "pending" ? actionButton(user.id, "approve", "批准") : "",
    user.status === "active" ? actionButton(user.id, "disable", "停用") : "",
    user.status === "disabled" ? actionButton(user.id, "enable", "启用") : "",
    user.status !== "pending" ? actionButton(user.id, "reset-link", "生成重置链接") : "",
    user.id !== admin.id ? actionButton(user.id, "delete", user.status === "pending" ? "拒绝并删除" : "删除账号", true) : "",
  ].filter(Boolean).join(" · ");
  const date = new Date(user.createdAt).toISOString().slice(0, 10);
  return `<tr><td>${escapeHtml(user.email)}</td><td>${user.role === "admin" ? "管理员" : "用户"}</td><td>${STATUS_LABEL[user.status]}</td><td>${date}</td><td>${actions}</td></tr>`;
}

async function adminPage(ctx: Ctx, admin: User, extra = "", status = 200): Promise<Response> {
  const users = await listUsers(ctx.env.PRIVATE_DB);
  const pending = users.filter((user) => user.status === "pending");
  const body = `<h1>管理</h1>${extra}
<h2>邀请码</h2><p class="muted">邀请码 7 天内有效、只能使用一次，生成后只显示这一次，请线下发给对方。</p>
<form method="post" action="/admin/invites"><button type="submit">生成邀请码</button></form>
<h2>待审批（${pending.length}）</h2>
<h2>全部用户（${users.length}）</h2>
<table><tr><th>邮箱</th><th>角色</th><th>状态</th><th>注册</th><th>操作</th></tr>${users.map((user) => userRow(user, admin)).join("")}</table>`;
  return html(layout("管理", body, admin), status);
}

async function targetUser(ctx: Ctx, userId: string): Promise<User> {
  const user = await findUserById(ctx.env.PRIVATE_DB, userId);
  if (!user) throw new HttpError(404, "用户不存在");
  return user;
}

function userAction(
  action: string,
  run: (ctx: Ctx, admin: User, target: User) => Promise<Response | void>,
): Route {
  return {
    method: "POST",
    pattern: new RegExp(`^/admin/users/([0-9a-f-]+)/${action}$`),
    async handler(ctx, [userId]) {
      const admin = await requireAdmin(ctx);
      const target = await targetUser(ctx, userId);
      const response = await run(ctx, admin, target);
      await audit(ctx.env.PRIVATE_DB, { actorUserId: admin.id, action: `admin.${action.replace("-", "_")}`, targetUserId: target.id }, ctx.deps.now());
      logEvent(`platform.admin.${action}`, { userId: admin.id, targetUserId: target.id });
      return response ?? redirect("/admin");
    },
  };
}

export const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/admin$/,
    async handler(ctx) {
      return adminPage(ctx, await requireAdmin(ctx));
    },
  },
  {
    method: "POST",
    pattern: /^\/admin\/invites$/,
    async handler(ctx) {
      const admin = await requireAdmin(ctx);
      const now = ctx.deps.now();
      const code = await createInvite(ctx.env.PRIVATE_DB, admin.id, now);
      await audit(ctx.env.PRIVATE_DB, { actorUserId: admin.id, action: "admin.invite", targetUserId: null }, now);
      return adminPage(ctx, admin, `<p class="notice">新邀请码（只显示这一次）：<code data-invite>${escapeHtml(code)}</code></p>`);
    },
  },
  userAction("approve", async (ctx, _admin, target) => {
    if (target.status !== "pending") throw new HttpError(400, "该用户不在待审批状态");
    await setUserStatus(ctx.env.PRIVATE_DB, target.id, "active", ctx.deps.now());
  }),
  userAction("disable", async (ctx, _admin, target) => {
    const db = ctx.env.PRIVATE_DB;
    if (target.role === "admin" && target.status === "active" && (await countActiveAdmins(db)) <= 1) {
      throw new HttpError(400, "不能停用唯一的管理员");
    }
    const now = ctx.deps.now();
    await setUserStatus(db, target.id, "disabled", now);
    await revokeUserSessions(db, target.id, now);
  }),
  userAction("enable", async (ctx, _admin, target) => {
    if (target.status !== "disabled") throw new HttpError(400, "该用户未被停用");
    await setUserStatus(ctx.env.PRIVATE_DB, target.id, "active", ctx.deps.now());
  }),
  userAction("delete", async (ctx, admin, target) => {
    const db = ctx.env.PRIVATE_DB;
    if (target.id === admin.id) throw new HttpError(400, "请在账号页删除自己的账号");
    if (target.role === "admin" && target.status === "active" && (await countActiveAdmins(db)) <= 1) {
      throw new HttpError(400, "不能删除唯一的管理员");
    }
    await eraseUser(ctx.env, target.id);
  }),
  userAction("reset-link", async (ctx, admin, target) => {
    if (target.status === "pending") throw new HttpError(400, "待审批用户不能重置密码");
    const token = await createResetToken(ctx.env.PRIVATE_DB, target.id, admin.id, ctx.deps.now());
    const link = `https://${ctx.env.PLATFORM_HOST}/reset#${token}`;
    return adminPage(ctx, admin, `${notice(`已为 ${target.email} 生成重置链接，24 小时内有效，只显示这一次，请线下转交：`)}<p><code>${escapeHtml(link)}</code></p>`);
  }),
];
