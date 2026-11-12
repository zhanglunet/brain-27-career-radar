/** 注册、登录、退出、重置密码与首个管理员初始化。 */
import { currentUser, sessionToken } from "../auth.ts";
import type { Route } from "../context.ts";
import { hashPassword, timingSafeEqual, verifyPassword } from "../crypto.ts";
import {
  audit,
  clearLoginFailures,
  completePasswordReset,
  consumeInvite,
  consumeResetToken,
  countActiveAdmins,
  createUser,
  deleteUserRow,
  findUserByEmail,
  isInviteValid,
  isLoginLocked,
  normalizeEmail,
  recordLoginFailure,
} from "../data/accounts.ts";
import { createSession, revokeSession } from "../data/sessions.ts";
import { HttpError, clearSessionCookie, html, logEvent, readForm, redirect, sessionCookie } from "../http.ts";
import { field, layout, messagePage, notice } from "../views.ts";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 256;
const MAX_EMAIL = 254;

function validEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD;
}

let dummyHashPromise: Promise<string> | null = null;
/** 未知邮箱登录时用于对齐耗时的假哈希。 */
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("dummy-password-for-timing");
  return dummyHashPromise;
}

const PASSWORD_HINT = `密码长度需为 ${MIN_PASSWORD}–${MAX_PASSWORD} 个字符。`;

function registerPage(message = "", status = 200): Response {
  const body = `<h1>注册</h1>${message ? notice(message, "error") : ""}<p class="muted">注册需要管理员发给你的邀请码，注册后需等待管理员审批。</p>
<form method="post" action="/register">${field("邀请码", "invite", "text", "required autocomplete=\"off\"")}${field("邮箱", "email", "email", "required autocomplete=\"email\"")}${field("密码", "password", "password", `required minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" autocomplete="new-password"`)}<button type="submit">注册</button></form>`;
  return html(layout("注册", body), status);
}

function loginPage(message = "", status = 200): Response {
  const body = `<h1>登录</h1>${message ? notice(message, "error") : ""}
<form method="post" action="/login">${field("邮箱", "email", "email", "required autocomplete=\"email\"")}${field("密码", "password", "password", "required autocomplete=\"current-password\"")}<button type="submit">登录</button></form>
<p class="muted">忘记密码请联系管理员获取重置链接。</p>`;
  return html(layout("登录", body), status);
}

function setupAvailable(token: string | undefined, admins: number): token is string {
  return Boolean(token) && admins === 0;
}

function setupPage(message = "", status = 200): Response {
  const body = `<h1>初始化管理员</h1>${message ? notice(message, "error") : ""}
<form method="post" action="/setup">${field("初始化口令", "token", "password", "required")}${field("管理员邮箱", "email", "email", "required")}${field("密码", "password", "password", `required minlength="${MIN_PASSWORD}"`)}<button type="submit">创建管理员</button></form>`;
  return html(layout("初始化", body), status);
}

/**
 * 重置令牌放在链接的 # 片段里（浏览器不会把片段发给服务器，因此不会进访问日志），
 * 由页面脚本填入表单，经 POST 字段提交。没有脚本时可以手动粘贴。
 */
function resetPage(message = "", status = 200): Response {
  const body = `<h1>设置新密码</h1>${message ? notice(message, "error") : ""}
<form method="post" action="/reset">${field("重置码", "token", "text", 'required autocomplete="off" id="reset-token"')}${field("新密码", "password", "password", `required minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" autocomplete="new-password"`)}<button type="submit">保存</button></form>
<script>(function(){var t=location.hash.slice(1);if(/^[A-Za-z0-9_-]+$/.test(t)){document.getElementById("reset-token").value=t;history.replaceState(null,"",location.pathname);}})();</script>`;
  return html(layout("重置密码", body), status);
}

export const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/setup$/,
    async handler(ctx) {
      if (!setupAvailable(ctx.env.ADMIN_BOOTSTRAP_TOKEN, await countActiveAdmins(ctx.env.PRIVATE_DB))) throw new HttpError(404, "页面不存在");
      return setupPage();
    },
  },
  {
    method: "POST",
    pattern: /^\/setup$/,
    async handler(ctx) {
      const db = ctx.env.PRIVATE_DB;
      const expected = ctx.env.ADMIN_BOOTSTRAP_TOKEN;
      if (!setupAvailable(expected, await countActiveAdmins(db))) throw new HttpError(404, "页面不存在");
      const form = await readForm(ctx.request);
      if (!timingSafeEqual(form.get("token") ?? "", expected)) return setupPage("初始化口令不正确", 403);
      const email = normalizeEmail(form.get("email") ?? "");
      const password = form.get("password") ?? "";
      if (!validEmail(email) || !validPassword(password)) return setupPage(`请填写有效邮箱。${PASSWORD_HINT}`, 400);
      const now = ctx.deps.now();
      const admin = await createUser(db, { email, passwordHash: await hashPassword(password), role: "admin", status: "active" }, now);
      await audit(db, { actorUserId: admin.id, action: "admin.bootstrap", targetUserId: admin.id }, now);
      logEvent("platform.admin.bootstrap", { userId: admin.id });
      return redirect("/", sessionCookie(await createSession(db, admin.id, now)));
    },
  },
  {
    method: "GET",
    pattern: /^\/register$/,
    async handler() {
      return registerPage();
    },
  },
  {
    method: "POST",
    pattern: /^\/register$/,
    async handler(ctx) {
      const db = ctx.env.PRIVATE_DB;
      const form = await readForm(ctx.request);
      const invite = (form.get("invite") ?? "").trim();
      const email = normalizeEmail(form.get("email") ?? "");
      const password = form.get("password") ?? "";
      if (!validEmail(email)) return registerPage("请填写有效的邮箱地址。", 400);
      if (!validPassword(password)) return registerPage(PASSWORD_HINT, 400);
      const now = ctx.deps.now();
      // 先校验邀请码再碰 users 表：不持有有效邀请码的人无法借"该邮箱已注册"探测他人账号。
      if (!invite || !(await isInviteValid(db, invite, now))) return registerPage("邀请码无效或已过期。", 400);
      let user;
      try {
        user = await createUser(db, { email, passwordHash: await hashPassword(password), role: "user", status: "pending" }, now);
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) return registerPage("该邮箱已注册。", 409);
        throw error;
      }
      if (!(await consumeInvite(db, invite, user.id, now))) {
        await deleteUserRow(db, user.id);
        return registerPage("邀请码无效或已过期。", 400);
      }
      await audit(db, { actorUserId: user.id, action: "user.register", targetUserId: user.id }, now);
      logEvent("platform.user.register", { userId: user.id });
      return html(messagePage("注册成功", "注册成功，请等待管理员审批后再登录。"));
    },
  },
  {
    method: "GET",
    pattern: /^\/login$/,
    async handler(ctx) {
      if (await currentUser(ctx)) return redirect("/");
      return loginPage();
    },
  },
  {
    method: "POST",
    pattern: /^\/login$/,
    async handler(ctx) {
      const db = ctx.env.PRIVATE_DB;
      const form = await readForm(ctx.request);
      const email = normalizeEmail(form.get("email") ?? "");
      const password = form.get("password") ?? "";
      const now = ctx.deps.now();
      if (await isLoginLocked(db, email, now)) return loginPage("尝试次数过多，请 15 分钟后再试。", 429);
      const user = email && password.length <= MAX_PASSWORD ? await findUserByEmail(db, email) : null;
      const passwordOk = await verifyPassword(password, user ? user.passwordHash : await dummyHash());
      if (!user || !passwordOk) {
        if (email) await recordLoginFailure(db, email, now);
        logEvent("platform.login.failed", { reason: user ? "password" : "unknown" });
        return loginPage("邮箱或密码错误。", 401);
      }
      if (user.status === "pending") return loginPage("账号等待审批，请联系管理员。", 403);
      if (user.status === "disabled") return loginPage("账号已停用。", 403);
      await clearLoginFailures(db, email);
      logEvent("platform.login.ok", { userId: user.id });
      return redirect("/", sessionCookie(await createSession(db, user.id, now)));
    },
  },
  {
    method: "POST",
    pattern: /^\/logout$/,
    async handler(ctx) {
      const token = sessionToken(ctx);
      if (token) await revokeSession(ctx.env.PRIVATE_DB, token, ctx.deps.now());
      return redirect("/login", clearSessionCookie());
    },
  },
  {
    method: "GET",
    pattern: /^\/reset$/,
    async handler() {
      return resetPage();
    },
  },
  {
    method: "POST",
    pattern: /^\/reset$/,
    async handler(ctx) {
      const db = ctx.env.PRIVATE_DB;
      const form = await readForm(ctx.request);
      const token = (form.get("token") ?? "").trim();
      const password = form.get("password") ?? "";
      if (!validPassword(password)) return resetPage(PASSWORD_HINT, 400);
      if (!/^[A-Za-z0-9_-]+$/.test(token)) return html(messagePage("链接无效", "链接无效或已过期，请联系管理员重新生成。", null, "error"), 400);
      const now = ctx.deps.now();
      const userId = await consumeResetToken(db, token, now);
      if (!userId) return html(messagePage("链接无效", "链接无效或已过期，请联系管理员重新生成。", null, "error"), 400);
      await completePasswordReset(db, userId, await hashPassword(password), now);
      await audit(db, { actorUserId: userId, action: "user.password_reset", targetUserId: userId }, now);
      return redirect("/login", clearSessionCookie());
    },
  },
];
