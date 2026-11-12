# 私有平台阶段 1a：账号与隔离地基 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一仓库中新建独立的私有平台 Worker：邀请注册 + 管理员审批、登录会话、知情同意、按用户隔离的数据访问层、入口防绕过、导出与删除，并以"意向目标（goals）"作为第一张用户数据表跑通隔离。

**Architecture:** 私有平台是 `platform/` 下的一个**纯 Worker**（不走 vinext、不带公开页面和 cron），用自己的 `platform/wrangler.jsonc` 部署。页面为服务端拼接的极简 HTML + 表单提交。私有 D1（`PRIVATE_DB`）存全部账号与用户数据；公开 D1（`PUBLIC_DB`）只经一个只读模块访问。所有用户数据 SQL 只允许出现在 `platform/data/` 中，并由测试静态守住。

**Tech Stack:** TypeScript（Node 原生类型剥离可直接运行）、Cloudflare Workers + D1、WebCrypto（PBKDF2 / SHA-256 / RS256）、`node:test` + `better-sqlite3`（测试中模拟 D1）、wrangler 4。

**Spec:** `docs/superpowers/specs/2026-11-12-multi-user-job-agent-platform-design.md`（本计划覆盖其 §6.1、§6.2、§6.8 与 §8 阶段 1a；1b、1c 另写计划）

## Global Constraints

- 私有平台代码全部在 `platform/`；不修改 `app/`、`worker/`、`vite.config.ts`、`db/`、`drizzle/` 中的任何文件（公开实例零改动）。
- 私有平台**永不写公开 D1**：`PUBLIC_DB` 只能在 `platform/data/public-readonly.ts` 中出现，且该文件只含 `SELECT`。
- 用户数据表的 SQL 只能出现在 `platform/data/`；每张含 `user_id` 的表必须登记在 `USER_TABLES`。
- 代码中不得出现任何领域专属词（脑科学、心理学、2027、BRAIN / 27 等）。
- 所有响应带 `Cache-Control: private, no-store`、`X-Robots-Tag: noindex, nofollow`、`Referrer-Policy: same-origin`（不能用 no-referrer：浏览器会把表单提交的 Origin 发成 null）；`/robots.txt` 返回 `User-agent: *\nDisallow: /`；不提供站点地图。
- `Host` 不等于 `env.PLATFORM_HOST` 的请求一律 404（防 workers.dev、预览 URL、替代域名绕过）；`platform/wrangler.jsonc` 中 `workers_dev: false`、`preview_urls: false`。
- 非 GET/HEAD 请求的 `Origin` 必须等于 `https://${PLATFORM_HOST}`，否则 403；仅当 `PLATFORM_HOST` 以 `.localhost` 结尾（本地开发）时，额外接受 `http://${PLATFORM_HOST}` 及带端口的同名 Origin。
- 会话 cookie：名称 `__Host-session`，`HttpOnly; Secure; SameSite=Lax; Path=/`，有效期 30 天；数据库只存令牌的 SHA-256。
- 密码：PBKDF2-SHA256，100000 次迭代（Workers 上限），16 字节盐，存储格式 `pbkdf2$100000$<saltB64url>$<hashB64url>`；长度 8–256。
- 邀请码 7 天有效、单次使用、只存哈希；重置链接 24 小时有效、单次使用、只存哈希；两者明文只在生成时展示一次。
- 登录失败锁定：同一邮箱 15 分钟内失败 5 次即锁 15 分钟。
- 邮箱一律 `trim().toLowerCase()` 后存储与比较，长度 ≤ 254。
- 请求体上限 65536 字节，超出返回 413。
- 日志只经 `logEvent`，字段白名单：`userId`、`targetUserId`、`route`、`status`、`count`、`reason`；不记录邮箱、密码、令牌、表单内容。
- 测试只用虚构数据（`@example.test` 邮箱、`platform.test` 主机名）。
- TS 写法须兼容 Node 原生类型剥离：不用 `enum`、`namespace`、构造函数参数属性；类型导入用 `import type`；相对导入带 `.ts` 扩展名。
- 提交信息结尾带会话要求的 Co-Authored-By 署名行（不要把署名邮箱写进 docs/，仓库隐私扫描会拦）。

## Review Focus

- **同一邮箱大小写 / 空格变体重复注册**（` A@Example.test ` 与 `a@example.test`）→ 视为同一邮箱，第二次注册失败。测试见 Task 5。
- **邀请码并发或重复使用、过期后使用** → 只有第一次在有效期内成功。测试见 Task 4、Task 5。
- **账号被停用或删除时仍持有旧会话** → 下一次请求即被视为未登录。测试见 Task 7。
- **唯一的管理员停用自己或删除自己的账号** → 拒绝，平台不能变成无人管理。测试见 Task 7、Task 6。
- **超长输入**（10MB 请求体、超长目标描述）→ 413 或表单校验错误，不写库。测试见 Task 3、Task 6。

---

## 文件结构

```
platform/
  env.ts                 PlatformEnv、Deps 类型
  wrangler.jsonc         私有 Worker 部署模板（占位 ID）
  worker.ts              Worker 入口：export default { fetch }
  app.ts                 handleRequest：host/origin 检查、路由分发、统一加安全头
  http.ts                响应构造、安全头、cookie、表单读取、HttpError、escapeHtml、logEvent
  crypto.ts              密码哈希、随机令牌、sha256
  access.ts              Cloudflare Access JWT 校验（/admin 额外防护）
  consent.ts             CONSENT_VERSION 与同意条款文本
  auth.ts                currentUser / requireUser / requireAdmin / requireConsent
  views.ts               页面骨架 layout() 与各页面 HTML 片段
  routes/
    auth-routes.ts       /register /login /logout /reset/:token /setup
    app-routes.ts        / /goals /consent /account /account/export /account/delete
    admin-routes.ts      /admin 及其子操作
  data/
    tables.ts            USER_TABLES、AUDIT_TABLES
    accounts.ts          users / invites / password_resets / login_attempts / audit_log
    sessions.ts          sessions
    consents.ts          consents
    scoped.ts            forUser(db, userId)：goals、exportAll、deleteAll
    public-readonly.ts   listPublicOpportunities（唯一允许使用 PUBLIC_DB 的文件）
  migrations/
    0001_accounts.sql
scripts/
  platform-deploy.mjs    注入真实 ID 生成配置 → 迁移 → 部署（&& 串联）
tests/
  helpers/sqlite-d1.mjs  用 better-sqlite3 实现 D1 接口 + applyPlatformMigrations
  platform-*.test.mjs
docs/platform/OPERATIONS.md
```

---

### Task 1: D1 测试替身与私有库迁移

**Files:**
- Create: `tests/helpers/sqlite-d1.mjs`
- Create: `platform/migrations/0001_accounts.sql`
- Create: `platform/env.ts`
- Test: `tests/platform-migrations.test.mjs`

**Interfaces:**
- Produces:
  - `createSqliteD1({ readonly?: boolean, path?: string }): D1Database` —— 实现 `prepare(sql).bind(...).first()/all()/run()` 与 `batch(stmts)`；`first()` 无行返回 `null`；`all()` 返回 `{ results }`；`run()` 返回 `{ success: true, meta: { changes } }`；`readonly: true` 时任何写操作抛错。
  - `applyPlatformMigrations(db): Promise<void>` —— 按文件名顺序执行 `platform/migrations/*.sql`。
  - `platform/env.ts`：
    ```ts
    export interface PlatformEnv {
      PRIVATE_DB: D1Database;
      PUBLIC_DB: D1Database;
      PLATFORM_HOST: string;
      ADMIN_BOOTSTRAP_TOKEN?: string;
      ACCESS_TEAM_DOMAIN?: string;
      ACCESS_AUD?: string;
    }
    export interface Deps { now(): number; fetchJwks?(url: string): Promise<unknown>; }
    ```
  - 表（全部时间列为毫秒整数 `INTEGER`）：
    - `users(id TEXT PK, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')), status TEXT NOT NULL CHECK(status IN ('pending','active','disabled')), created_at, approved_at, disabled_at)`
    - `invites(code_hash TEXT PK, created_by TEXT NOT NULL, created_at, expires_at NOT NULL, used_by TEXT, used_at)`
    - `sessions(token_hash TEXT PK, user_id TEXT NOT NULL REFERENCES users(id), created_at, expires_at NOT NULL, revoked_at)`
    - `consents(id TEXT PK, user_id TEXT NOT NULL REFERENCES users(id), version TEXT NOT NULL, accepted_at NOT NULL, UNIQUE(user_id, version))`
    - `password_resets(token_hash TEXT PK, user_id TEXT NOT NULL REFERENCES users(id), created_by TEXT NOT NULL, created_at, expires_at NOT NULL, used_at)`
    - `login_attempts(email TEXT NOT NULL, attempted_at INTEGER NOT NULL)`，索引 `(email, attempted_at)`
    - `goals(id TEXT PK, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, description TEXT NOT NULL, created_at NOT NULL)`，索引 `(user_id)`
    - `audit_log(id TEXT PK, actor_user_id TEXT, action TEXT NOT NULL, target_user_id TEXT, at INTEGER NOT NULL)`

- [ ] **Step 1: 写失败测试 `tests/platform-migrations.test.mjs`**

```js
test("迁移创建全部私有表", async () => {
  const db = createSqliteD1();
  await applyPlatformMigrations(db);
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = results.map((r) => r.name);
  for (const t of ["users","invites","sessions","consents","password_resets","login_attempts","goals","audit_log"]) {
    assert.ok(names.includes(t), t);
  }
});
test("role 与 status 有 CHECK 约束", async () => {
  // 插入 role='root' 与 status='banned' 都应抛错
});
test("readonly 替身拒绝写入", async () => {
  const db = createSqliteD1({ readonly: true });
  await assert.rejects(() => db.prepare("CREATE TABLE x(a)").run());
});
```

- [ ] **Step 2: 运行确认失败** —— `node --test tests/platform-migrations.test.mjs`，预期 FAIL（找不到模块）。
- [ ] **Step 3: 实现** `tests/helpers/sqlite-d1.mjs`、`platform/migrations/0001_accounts.sql`、`platform/env.ts`。`readonly` 用内存库先执行迁移再以 `readonly: true` 打开同一临时文件路径实现；测试可传 `path`。
- [ ] **Step 4: 运行确认通过** —— 同上命令，预期 PASS。
- [ ] **Step 5: 提交** —— `git add platform tests/helpers/sqlite-d1.mjs tests/platform-migrations.test.mjs && git commit -m "feat(platform): 私有库迁移与 D1 测试替身"`

---

### Task 2: 密码与令牌

**Files:**
- Create: `platform/crypto.ts`
- Test: `tests/platform-crypto.test.mjs`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): Promise<string>`
  - `verifyPassword(password: string, stored: string): Promise<boolean>` —— 常量时间比较；格式不符返回 `false` 不抛错。
  - `randomToken(bytes?: number): string` —— 默认 32 字节，base64url。
  - `sha256Hex(input: string): Promise<string>`
  - `timingSafeEqual(a: string, b: string): boolean`

- [ ] **Step 1: 写失败测试**

```js
test("哈希格式与校验", async () => {
  const h = await hashPassword("correct horse");
  assert.match(h, /^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPassword("correct horse", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
});
test("同一密码两次哈希不同（加盐）", async () => {
  assert.notEqual(await hashPassword("x".repeat(8)), await hashPassword("x".repeat(8)));
});
test("损坏的存储值返回 false", async () => {
  assert.equal(await verifyPassword("a", "garbage"), false);
});
test("randomToken 长度与唯一性", () => {
  assert.equal(randomToken().length, 43);
  assert.notEqual(randomToken(), randomToken());
});
```

- [ ] **Step 2: 运行确认失败** —— `node --test tests/platform-crypto.test.mjs`
- [ ] **Step 3: 实现** `platform/crypto.ts`（`crypto.subtle.importKey("raw", …, "PBKDF2")` + `deriveBits` 256 位）。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** —— `feat(platform): 密码哈希与随机令牌`

---

### Task 3: HTTP 基础件

**Files:**
- Create: `platform/http.ts`
- Test: `tests/platform-http.test.mjs`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { status: number }`（构造函数 `(status: number, message: string)`，字段在构造函数体内赋值）
  - `withSecurityHeaders(res: Response): Response` —— 加上 Global Constraints 中的三个头。
  - `html(body: string, status?: number): Response`、`redirect(location: string, setCookie?: string): Response`（303）、`jsonDownload(data: unknown, filename: string): Response`
  - `parseCookies(header: string | null): Record<string, string>`
  - `sessionCookie(token: string): string`、`clearSessionCookie(): string`
  - `isAllowedHost(request: Request, env: PlatformEnv): boolean`
  - `isAllowedOrigin(request: Request, env: PlatformEnv): boolean` —— GET/HEAD 恒为 `true`。
  - `readForm(request: Request): Promise<URLSearchParams>` —— 先看 `Content-Length`，再按实际读取字节计数，超过 65536 抛 `HttpError(413)`。
  - `escapeHtml(s: string): string`
  - `logEvent(event: string, fields: Record<string, unknown>): void` —— 白名单外字段丢弃，`console.log(JSON.stringify({ event, ...kept }))`。

- [ ] **Step 1: 写失败测试**

```js
test("安全头", () => {
  const r = withSecurityHeaders(new Response("x"));
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
});
test("会话 cookie 属性", () => {
  const c = sessionCookie("tok");
  for (const part of ["__Host-session=tok", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) assert.ok(c.includes(part), part);
});
test("Host 校验拒绝 workers.dev 与其他域名", () => {
  const env = { PLATFORM_HOST: "platform.test" };
  assert.equal(isAllowedHost(new Request("https://platform.test/"), env), true);
  assert.equal(isAllowedHost(new Request("https://x.y.workers.dev/"), env), false);
  assert.equal(isAllowedHost(new Request("https://evil.test/"), env), false);
});
test("POST 的 Origin 必须匹配", () => {
  const env = { PLATFORM_HOST: "platform.test" };
  const ok = new Request("https://platform.test/login", { method: "POST", headers: { origin: "https://platform.test" } });
  const bad = new Request("https://platform.test/login", { method: "POST", headers: { origin: "https://evil.test" } });
  const none = new Request("https://platform.test/login", { method: "POST" });
  assert.equal(isAllowedOrigin(ok, env), true);
  assert.equal(isAllowedOrigin(bad, env), false);
  assert.equal(isAllowedOrigin(none, env), false);
});
test("超大请求体 413", async () => {
  const req = new Request("https://platform.test/x", { method: "POST", body: "a=" + "x".repeat(70000), headers: { "content-type": "application/x-www-form-urlencoded" } });
  await assert.rejects(() => readForm(req), (e) => e.status === 413);
});
test("logEvent 丢弃白名单外字段", (t) => {
  const lines = []; t.mock.method(console, "log", (s) => lines.push(s));
  logEvent("x", { userId: "u1", email: "a@example.test", password: "p" });
  assert.deepEqual(JSON.parse(lines[0]), { event: "x", userId: "u1" });
});
test("escapeHtml", () => assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"));
```

- [ ] **Step 2: 运行确认失败** —— `node --test tests/platform-http.test.mjs`
- [ ] **Step 3: 实现** `platform/http.ts`。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** —— `feat(platform): HTTP 安全头、cookie、Host/Origin 校验与日志白名单`

---

### Task 4: 数据访问层与静态守卫

**Files:**
- Create: `platform/data/tables.ts`、`platform/data/accounts.ts`、`platform/data/sessions.ts`、`platform/data/consents.ts`、`platform/data/scoped.ts`、`platform/data/public-readonly.ts`
- Test: `tests/platform-data.test.mjs`、`tests/platform-guards.test.mjs`

**Interfaces:**
- Consumes: Task 1 的表结构，Task 2 的 `randomToken`、`sha256Hex`。
- Produces（所有函数第一个参数为 `db: D1Database`，时间参数 `now: number` 毫秒）：
  - `tables.ts`：`export const USER_TABLES = ["goals", "consents", "password_resets", "sessions"] as const;`（删除顺序即此顺序，最后删 `users`）；`export const ID_ONLY_TABLES = ["audit_log"] as const;`（只含 ID，账号删除后保留）。
  - `type User = { id: string; email: string; role: "admin" | "user"; status: "pending" | "active" | "disabled"; createdAt: number }`
  - `accounts.ts`：
    - `normalizeEmail(raw: string): string`
    - `createUser(db, { email, passwordHash, role, status }, now): Promise<User>` —— 邮箱冲突抛 `HttpError(409, "该邮箱已注册")`。
    - `findUserByEmail(db, email): Promise<(User & { passwordHash: string }) | null>`、`findUserById(db, id): Promise<User | null>`
    - `listUsers(db, status?: User["status"]): Promise<User[]>`
    - `setUserStatus(db, userId, status, now): Promise<void>`
    - `countActiveAdmins(db): Promise<number>`
    - `setPassword(db, userId, passwordHash): Promise<void>`
    - `createInvite(db, createdBy, now): Promise<string>` —— 返回明文码，存 `sha256Hex`，`expires_at = now + 7d`。
    - `consumeInvite(db, code, userId, now): Promise<boolean>` —— 单条 `UPDATE invites SET used_by=?, used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at > ?`，`changes === 1` 才为 `true`。
    - `createResetToken(db, userId, adminId, now): Promise<string>`（24h）、`consumeResetToken(db, token, now): Promise<string | null>`（同样单条条件 UPDATE，返回 userId）
    - `recordLoginFailure(db, email, now)`、`isLoginLocked(db, email, now): Promise<boolean>`（15 分钟窗口内 ≥ 5 次）、`clearLoginFailures(db, email)`
    - `audit(db, { actorUserId, action, targetUserId }, now): Promise<void>`
  - `sessions.ts`：`createSession(db, userId, now): Promise<string>`（30 天）、`findSessionUser(db, token, now): Promise<User | null>`（未撤销、未过期、且用户 `status = 'active'`）、`revokeSession(db, token, now)`、`revokeUserSessions(db, userId, now)`
  - `consents.ts`：`recordConsent(db, userId, version, now)`、`hasConsent(db, userId, version): Promise<boolean>`
  - `scoped.ts`：
    ```ts
    export type Goal = { id: string; title: string; description: string; createdAt: number };
    export type UserExport = { exportedAt: number; user: User; consents: { version: string; acceptedAt: number }[]; goals: Goal[] };
    export function forUser(db: D1Database, userId: string): {
      goals: { list(): Promise<Goal[]>; create(input: { title: string; description: string }, now: number): Promise<Goal>; remove(goalId: string): Promise<boolean> };
      exportAll(now: number): Promise<UserExport>;
      deleteAll(): Promise<void>; // 按 USER_TABLES 顺序删 WHERE user_id = ?，最后删 users；用 db.batch 一次提交
    };
    ```
    每条 SQL 都带 `user_id = ?` 并绑定闭包中的 `userId`；`remove` 用 `WHERE id = ? AND user_id = ?`。
  - `public-readonly.ts`：`listPublicOpportunities(db: D1Database, limit: number): Promise<{ id: string; name: string; org: string; kind: string; location: string; deadline: string; url: string }[]>` —— `SELECT … FROM opportunities WHERE published = 1 ORDER BY id LIMIT ?`，`limit` 夹在 1–100。

- [ ] **Step 1: 写失败测试 `tests/platform-data.test.mjs`**

```js
test("forUser 之间互不可见", async () => {
  const db = await freshDb(); const a = await mkUser(db, "a@example.test"); const b = await mkUser(db, "b@example.test");
  const g = await forUser(db, a.id).goals.create({ title: "国内校招", description: "互联网产品岗" }, 1);
  assert.equal((await forUser(db, b.id).goals.list()).length, 0);
  assert.equal(await forUser(db, b.id).goals.remove(g.id), false);
  assert.equal((await forUser(db, a.id).goals.list()).length, 1);
});
test("邀请码只能成功使用一次且过期失效", async () => {
  const db = await freshDb(); const admin = await mkUser(db, "admin@example.test", "admin");
  const code = await createInvite(db, admin.id, 0);
  assert.equal(await consumeInvite(db, code, "u1", 1), true);
  assert.equal(await consumeInvite(db, code, "u2", 2), false);
  const late = await createInvite(db, admin.id, 0);
  assert.equal(await consumeInvite(db, late, "u3", 7 * 86400000 + 1), false);
});
test("停用用户的会话立即失效", async () => {
  const db = await freshDb(); const u = await mkUser(db, "c@example.test");
  const tok = await createSession(db, u.id, 0);
  assert.equal((await findSessionUser(db, tok, 1)).id, u.id);
  await setUserStatus(db, u.id, "disabled", 2);
  assert.equal(await findSessionUser(db, tok, 3), null);
});
test("登录失败 5 次锁定 15 分钟", async () => { /* 4 次不锁；第 5 次后锁；now + 15min + 1 后解锁 */ });
test("deleteAll 清空该用户所有 USER_TABLES 行且不动他人", async () => {
  // a、b 各有 goal/consent/session；deleteAll(a) 后每张 USER_TABLES 中 user_id=a 的行数为 0，b 的行数不变，users 中无 a
});
test("normalizeEmail", () => assert.equal(normalizeEmail("  A@Example.TEST "), "a@example.test"));
test("公开只读模块只读", async () => {
  const pub = createSqliteD1({ readonly: true, path: fixturePublicDbPath() }); // 测试内建一张最小 opportunities 表
  assert.ok(Array.isArray(await listPublicOpportunities(pub, 500)));
});
```

- [ ] **Step 2: 写失败测试 `tests/platform-guards.test.mjs`（静态守卫）**

```js
// 读取 platform/ 下所有 .ts 文件文本
test("用户表 SQL 只出现在 platform/data/", () => {
  const re = /\b(FROM|INTO|UPDATE|JOIN)\s+(users|invites|sessions|consents|password_resets|login_attempts|goals|audit_log)\b/i;
  for (const f of platformFiles().filter((f) => !f.startsWith("platform/data/"))) assert.doesNotMatch(read(f), re, f);
});
test("PUBLIC_DB 只出现在 public-readonly.ts 和 env.ts", () => { /* 其余文件不得包含 "PUBLIC_DB" */ });
test("public-readonly.ts 不含写语句", () => {
  assert.doesNotMatch(read("platform/data/public-readonly.ts"), /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i);
});
test("每张含 user_id 的表都登记在 USER_TABLES 或 ID_ONLY_TABLES", async () => {
  // 对迁移后的库逐表 PRAGMA table_info，含 user_id / target_user_id 列者必须在两表之一
});
test("platform/ 不含领域专属词", () => {
  for (const f of platformFiles()) assert.doesNotMatch(read(f), /脑科学|心理学|2027|BRAIN \/ 27|brain27/i, f);
});
```

- [ ] **Step 3: 运行确认失败** —— `node --test tests/platform-data.test.mjs tests/platform-guards.test.mjs`
- [ ] **Step 4: 实现** `platform/data/*`。
- [ ] **Step 5: 运行确认通过**
- [ ] **Step 6: 提交** —— `feat(platform): 按用户隔离的数据访问层与静态守卫`

---

### Task 5: 应用骨架、登录注册与首个管理员

**Files:**
- Create: `platform/app.ts`、`platform/auth.ts`、`platform/consent.ts`、`platform/views.ts`、`platform/routes/auth-routes.ts`
- Test: `tests/platform-auth.test.mjs`；共享测试工具 `tests/helpers/platform-client.mjs`

**Interfaces:**
- Consumes: Task 3、Task 4 全部导出。
- Produces:
  - `handleRequest(request: Request, env: PlatformEnv, deps: Deps): Promise<Response>` —— 顺序：`isAllowedHost` 否 → 404；`isAllowedOrigin` 否 → 403；路由匹配；捕获 `HttpError` 渲染错误页；最后 `withSecurityHeaders`。未匹配 → 404。`GET /robots.txt` 返回 Global Constraints 中的文本。
  - 路由注册形式：`type Route = { method: "GET" | "POST"; pattern: RegExp; handler(ctx: Ctx, params: string[]): Promise<Response> }`，`type Ctx = { request: Request; env: PlatformEnv; deps: Deps; url: URL }`；各 `routes/*.ts` 导出 `routes: Route[]`。
  - `auth.ts`：`currentUser(ctx): Promise<User | null>`；`requireUser(ctx): Promise<User>`（未登录抛 `HttpError(303)` 并由 `app.ts` 转为跳转 `/login`）；`requireAdmin(ctx): Promise<User>`（非管理员 403）；`requireConsent(ctx, user): Promise<void>`（未同意当前版本 → 跳转 `/consent`）。
  - `consent.ts`：`export const CONSENT_VERSION = "v1";` 与 `CONSENT_POINTS: string[]`，内容须覆盖：账号与求职资料存于平台的 Cloudflare 账号（D1，简历文件存 R2）；简历与意向会发送给 DeepSeek 用于解析与匹配；找机会时会把检索词发给搜索服务；绑定浏览器节点后智能体会用你自己的账号只读浏览招聘网站，可能违反平台条款导致限流或封号；不是端到端加密；可随时导出与删除，删除后备份保留期内仍可能存在；对外发送一律需本人确认。
  - 测试工具 `platform-client.mjs`：`makeEnv(): Promise<{ env, deps, clock }>`（内存私有库 + 只读公开库 + `PLATFORM_HOST: "platform.test"` + `ADMIN_BOOTSTRAP_TOKEN: "test-bootstrap"`，`clock.set(ms)` 控制 `deps.now`）；`client(env, deps)` 返回 `{ get(path), post(path, form), cookie }`，自动带 `Origin: https://platform.test` 并保存 `__Host-session`。
  - 路由：
    - `GET/POST /setup`：仅当 `countActiveAdmins === 0` 且 `ADMIN_BOOTSTRAP_TOKEN` 已设置时可用，否则 404；表单 `token, email, password`，`timingSafeEqual` 比对后创建 `active` 管理员并登录。
    - `GET/POST /register`：表单 `invite, email, password`；先建 `pending` 用户再 `consumeInvite`，失败则删除刚建用户并报"邀请码无效或已过期"（二者放在同一 `db.batch` 中不可行时按此补偿）；成功显示"等待管理员审批"。
    - `GET/POST /login`：锁定中 → "尝试次数过多，请 15 分钟后再试"；`pending` → "账号等待审批"；`disabled` → "账号已停用"；成功 → `createSession`、`clearLoginFailures`、跳转 `/`。错误信息对"邮箱不存在"与"密码错误"一致：都显示"邮箱或密码错误"。
    - `POST /logout`：撤销会话、清 cookie、跳转 `/login`。
    - `GET/POST /reset/:token`：表单 `password`；`consumeResetToken` 成功则 `setPassword` + `revokeUserSessions`。

- [ ] **Step 1: 写失败测试 `tests/platform-auth.test.mjs`**

```js
test("首个管理员只能经 bootstrap 建立一次", async () => {
  const { env, deps } = await makeEnv(); const c = client(env, deps);
  assert.equal((await c.post("/setup", { token: "wrong", email: "admin@example.test", password: "adminpass1" })).status, 403);
  assert.equal((await c.post("/setup", { token: "test-bootstrap", email: "admin@example.test", password: "adminpass1" })).status, 303);
  assert.equal((await client(env, deps).get("/setup")).status, 404);
});
test("注册→待审批→不能登录", async () => { /* 用管理员建的邀请码注册；login 返回含"账号等待审批" */ });
test("大小写不同的同一邮箱不能重复注册", async () => {
  // 两个有效邀请码；先 " A@Example.test "，再 "a@example.test" → 第二次页面含"该邮箱已注册"，第二个邀请码仍未被使用
});
test("邀请码用过后再注册失败", async () => {});
test("邮箱不存在与密码错误提示一致", async () => {});
test("连续 5 次密码错误后锁定，即使密码正确也拒绝", async () => {});
test("错误 Host 404、缺 Origin 的 POST 403", async () => {
  const { env, deps } = await makeEnv();
  assert.equal((await handleRequest(new Request("https://x.workers.dev/login"), env, deps)).status, 404);
  assert.equal((await handleRequest(new Request("https://platform.test/login", { method: "POST" }), env, deps)).status, 403);
});
test("每个响应都带安全头，robots.txt 禁止抓取", async () => {});
test("重置链接一次有效且会撤销旧会话", async () => {});
```

- [ ] **Step 2: 运行确认失败** —— `node --test tests/platform-auth.test.mjs`
- [ ] **Step 3: 实现** `app.ts`、`auth.ts`、`consent.ts`、`views.ts`、`routes/auth-routes.ts`、`tests/helpers/platform-client.mjs`。所有输出到 HTML 的用户数据都经 `escapeHtml`。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** —— `feat(platform): 应用骨架、邀请注册、登录与管理员初始化`

---

### Task 6: 同意、意向目标、导出与删除

**Files:**
- Create: `platform/routes/app-routes.ts`
- Modify: `platform/app.ts`（注册 `app-routes`）、`platform/views.ts`
- Test: `tests/platform-app.test.mjs`

**Interfaces:**
- Consumes: Task 5 的 `requireUser`、`requireConsent`、`CONSENT_VERSION`、`CONSENT_POINTS`，Task 4 的 `forUser`、`recordConsent`、`countActiveAdmins`。
- Produces（路由）：
  - `GET /consent` 展示 `CONSENT_POINTS`；`POST /consent`（表单 `agree=yes`）记录 `CONSENT_VERSION` 后跳转 `/`。
  - `GET /`：`requireUser` + `requireConsent`；列出本人目标，含新建表单。
  - `POST /goals`：`title` 1–100 字、`description` 1–4000 字（按 `[...s].length` 计），不合规返回 400 页面且不写库。
  - `POST /goals/:id/delete`：只删本人的；不存在或非本人 → 404。
  - `GET /account`：账号信息、导出按钮、删除表单（需输入密码）。
  - `GET /account/export`：`jsonDownload(forUser(...).exportAll(now), "export.json")`；内容不含 `passwordHash`、会话令牌。
  - `POST /account/delete`：校验密码；若本人是唯一 `active` 管理员 → 400"不能删除唯一的管理员账号"；否则 `forUser(...).deleteAll()`、清 cookie、跳转 `/login`，并 `audit(action: "account.delete")`。

- [ ] **Step 1: 写失败测试 `tests/platform-app.test.mjs`**

```js
test("未同意条款不能进入首页", async () => { /* 登录后 GET / → 303 Location: /consent；同意后 GET / → 200 */ });
test("A 不能删除 B 的目标，且 B 的目标不出现在 A 的页面", async () => {
  // B 建目标 title "B 的专属目标"；A GET / 不含该文本；A POST /goals/<B 的 id>/delete → 404；B 仍能看到
});
test("超长描述被拒且不写库", async () => {
  // description 4001 字 → 400；forUser(...).goals.list() 长度为 0
});
test("目标标题中的 HTML 被转义", async () => { /* title "<script>x</script>" 页面中出现 "&lt;script&gt;" 且无 "<script>x" */ });
test("导出只含本人数据且无密码哈希与令牌", async () => {});
test("删除账号后旧会话失效、数据清空、他人不受影响", async () => {});
test("唯一管理员不能删除自己", async () => {});
```

- [ ] **Step 2: 运行确认失败** —— `node --test tests/platform-app.test.mjs`
- [ ] **Step 3: 实现** `platform/routes/app-routes.ts` 并在 `app.ts` 注册。
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** —— `feat(platform): 知情同意、意向目标、导出与删除账号`

---

### Task 7: 管理后台与 Cloudflare Access 校验

**Files:**
- Create: `platform/access.ts`、`platform/routes/admin-routes.ts`
- Modify: `platform/app.ts`、`platform/views.ts`
- Test: `tests/platform-admin.test.mjs`、`tests/platform-access.test.mjs`

**Interfaces:**
- Consumes: Task 4 账号函数，Task 5 `requireAdmin`。
- Produces:
  - `verifyAccessJwt(token: string, opts: { teamDomain: string; aud: string; now: number; fetchJwks(url: string): Promise<unknown> }): Promise<boolean>` —— 解析 JWT，`alg` 必须为 `RS256`；从 `https://${teamDomain}/cdn-cgi/access/certs` 取 JWKS，按 `kid` 选钥，用 `crypto.subtle.verify("RSASSA-PKCS1-v1_5")` 验签；`aud` 包含 `opts.aud`、`iss === "https://" + teamDomain`、`exp > now/1000`。任何异常返回 `false`。
  - `app.ts`：路径以 `/admin` 开头且 `env.ACCESS_AUD` 已设置时，读 `Cf-Access-Jwt-Assertion` 头，`verifyAccessJwt` 不通过 → 403（在 `requireAdmin` 之前执行）。
  - 路由（均需 `requireAdmin`，写操作都 `audit`）：
    - `GET /admin`：待审批用户、全部用户（邮箱、角色、状态、注册时间）、生成邀请码按钮。**不展示任何用户的目标或其他私人内容。**
    - `POST /admin/invites`：生成邀请码，页面展示一次明文。
    - `POST /admin/users/:id/approve`：`pending → active`。
    - `POST /admin/users/:id/disable`：`→ disabled` 并 `revokeUserSessions`；若目标是唯一 `active` 管理员 → 400"不能停用唯一的管理员"。
    - `POST /admin/users/:id/enable`：`disabled → active`。
    - `POST /admin/users/:id/reset-link`：生成重置令牌，页面展示一次 `https://${PLATFORM_HOST}/reset/<token>`。

- [ ] **Step 1: 写失败测试 `tests/platform-access.test.mjs`**

```js
// 测试内用 crypto.subtle.generateKey 生成 RSA 钥对，构造 JWKS 与签名 JWT
test("合法 Access JWT 通过", async () => {});
test("aud 不符、过期、签名错、alg=none、kid 不存在均拒绝", async () => {});
test("配置 ACCESS_AUD 后 /admin 无头 403，合法头 + 管理员会话 200", async () => {});
```

- [ ] **Step 2: 写失败测试 `tests/platform-admin.test.mjs`**

```js
test("普通用户访问 /admin 403", async () => {});
test("审批后用户可登录", async () => {});
test("停用用户后其现有会话立即失效", async () => {
  // 用户登录拿到会话；管理员 disable；用户 GET / → 303 /login
});
test("唯一管理员不能停用自己", async () => {});
test("管理页面不含用户目标内容", async () => {
  // 用户建目标 "私人目标-机密"；管理员 GET /admin 不含该文本
});
test("重置链接页面只显示一次明文", async () => {});
```

- [ ] **Step 3: 运行确认失败** —— `node --test tests/platform-access.test.mjs tests/platform-admin.test.mjs`
- [ ] **Step 4: 实现** `platform/access.ts`、`platform/routes/admin-routes.ts`，在 `app.ts` 注册与接入 Access 检查。
- [ ] **Step 5: 运行确认通过**
- [ ] **Step 6: 提交** —— `feat(platform): 管理后台与 Cloudflare Access 二次校验`

---

### Task 8: Worker 入口、部署配置与端到端隔离测试

**Files:**
- Create: `platform/worker.ts`、`platform/wrangler.jsonc`、`scripts/platform-deploy.mjs`
- Modify: `package.json`（新增脚本，见下）
- Test: `tests/platform-e2e.test.mjs`、`tests/platform-config.test.mjs`

**Interfaces:**
- Consumes: Task 5 `handleRequest`。
- Produces:
  - `platform/worker.ts`：`export default { fetch(request, env, ctx) { return handleRequest(request, env, { now: Date.now, fetchJwks: (u) => fetch(u).then((r) => r.json()) }); } } satisfies ExportedHandler<PlatformEnv>;`
  - `platform/wrangler.jsonc`：`name: "job-agent-platform"`，`main: "./worker.ts"`，`compatibility_date: "2026-07-31"`，`compatibility_flags: ["nodejs_compat"]`，`workers_dev: false`，`preview_urls: false`，`d1_databases`：`PRIVATE_DB`（`migrations_dir: "migrations"`，ID 占位 `00000000-0000-0000-0000-000000000137`）与 `PUBLIC_DB`（ID 占位 `00000000-0000-0000-0000-000000000027`），`vars: { PLATFORM_HOST: "platform.localhost" }`，无 `triggers`、无 `assets`、无 `ai`。
  - `scripts/platform-deploy.mjs`：通过 `PATH` 查找并调用 `wrangler` 可执行文件（便于测试替换）；必需环境变量 `PLATFORM_D1_ID`、`PUBLIC_D1_ID`、`PLATFORM_HOST`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`，缺一即退出码 1 并列出缺失项；生成 `dist/platform/wrangler.json`（替换 ID、`PLATFORM_HOST`、`ACCESS_*` 写入 `vars`、加 `routes: [{ pattern: PLATFORM_HOST, custom_domain: true }]`、`main` 与 `PRIVATE_DB.migrations_dir` 改写为仓库内 `platform/worker.ts`、`platform/migrations` 的绝对路径，因为生成的配置位于 `dist/platform/`）；然后依次执行 `wrangler d1 migrations apply PRIVATE_DB --remote --config dist/platform/wrangler.json` **成功后**才执行 `wrangler deploy --config dist/platform/wrangler.json`（任一步失败立即退出，不继续）。`--dry-run` 只生成配置不执行命令。
  - `package.json` 新增：
    - `"platform:dev": "wrangler dev --config platform/wrangler.jsonc --persist-to .wrangler/platform-state"`
    - `"platform:migrate:local": "wrangler d1 migrations apply PRIVATE_DB --local --persist-to .wrangler/platform-state --config platform/wrangler.jsonc"`
    - `"platform:deploy": "node scripts/platform-deploy.mjs"`

- [ ] **Step 1: 写失败测试 `tests/platform-config.test.mjs`**

```js
test("私有平台配置关闭 workers.dev 与预览 URL，且无 cron", () => {
  const cfg = parseJsonc(read("platform/wrangler.jsonc"));
  assert.equal(cfg.workers_dev, false); assert.equal(cfg.preview_urls, false);
  assert.equal(cfg.triggers, undefined);
  assert.deepEqual(cfg.d1_databases.map((d) => d.binding).sort(), ["PRIVATE_DB", "PUBLIC_DB"]);
});
test("公开实例配置不含任何私有绑定", () => {
  const src = read("vite.config.ts");
  for (const s of ["PRIVATE_DB", "PUBLIC_DB", "DEEPSEEK", "r2_buckets"]) assert.ok(!src.includes(s), s);
});
test("部署脚本缺环境变量时退出码 1 且不调用 wrangler", () => {
  // spawnSync("node", ["scripts/platform-deploy.mjs", "--dry-run"], { env: { PATH } }) → status 1，stderr 含 "PLATFORM_D1_ID"
});
test("部署脚本 --dry-run 生成的配置含自定义域名与真实 ID", () => {});
test("迁移失败时不执行部署", () => {
  // 在临时目录放一个假的 wrangler 可执行文件：收到 "migrations" 参数时记录调用并以退出码 1 结束，收到 "deploy" 时记录调用并以 0 结束
  // 把它放到 PATH 最前，设齐 5 个环境变量运行 scripts/platform-deploy.mjs（不加 --dry-run）
  // 断言：脚本退出码非 0；调用记录里有 migrations、没有 deploy
});
```

- [ ] **Step 2: 写失败测试 `tests/platform-e2e.test.mjs`**（通过 `platform/worker.ts` 的 `default.fetch` 驱动，环境用 Task 5 的 `makeEnv`）

```js
test("两个用户全流程隔离", async () => {
  // bootstrap 管理员 → 两个邀请码 → A、B 注册 → 管理员审批 → 各自同意条款 → 各建 1 个目标
  // A 的 / 页面、/account/export 中都不含 B 的邮箱与目标标题，反之亦然
  // A 带自己的会话 POST /goals/<B 的目标 id>/delete → 404
  // B 被停用后，B 的会话访问 / → 303 /login；A 不受影响
});
test("未登录访问所有私有路由都跳转登录或 403/404", async () => {
  for (const p of ["/", "/account", "/account/export", "/admin", "/consent"]) {
    const r = await anon.get(p); assert.ok([303, 403, 404].includes(r.status), p);
    if (r.status === 303) assert.equal(r.headers.get("location"), "/login");
  }
});
test("所有响应都带 private, no-store", async () => {});
```

- [ ] **Step 3: 运行确认失败** —— `node --test tests/platform-config.test.mjs tests/platform-e2e.test.mjs`
- [ ] **Step 4: 实现** `platform/worker.ts`、`platform/wrangler.jsonc`、`scripts/platform-deploy.mjs`，修改 `package.json`。
- [ ] **Step 5: 运行确认通过**
- [ ] **Step 6: 全量验证** —— `npm run verify`，预期 typecheck、lint、全部测试（含原有公开实例测试）通过。
- [ ] **Step 7: 本地冒烟** —— `npm run platform:migrate:local && npm run platform:dev`，用 `curl -H "Host: platform.localhost" http://127.0.0.1:8787/robots.txt` 得到 `Disallow: /`；`curl http://127.0.0.1:8787/robots.txt`（Host 为 127.0.0.1）得到 404。
- [ ] **Step 8: 提交** —— `feat(platform): Worker 入口、部署配置与端到端隔离测试`

---

### Task 9: 运维与数据边界文档

**Files:**
- Create: `docs/platform/OPERATIONS.md`
- Modify: `docs/OPERATIONS.md`（在"本地助手数据边界"一节末尾加一段指向新文档）、`README.md`（在本地申请助手一节后加"私有平台（开发中）"一小节，两三行 + 链接）

内容要求（`docs/platform/OPERATIONS.md`）：
- 架构与绑定：私有 Worker、`PRIVATE_DB`、`PUBLIC_DB`（代码层只读）、无 cron、`workers_dev`/预览关闭、Host 校验。
- 首次部署：创建私有 D1；`wrangler secret put ADMIN_BOOTSTRAP_TOKEN --config dist/platform/wrangler.json`；在 Cloudflare Zero Trust 为 `PLATFORM_HOST/admin*` 建 Access 应用并取得 AUD；设置 5 个环境变量后 `npm run platform:deploy`；访问 `/setup` 建首个管理员；**之后删除 `ADMIN_BOOTSTRAP_TOKEN` secret**。
- 日常：生成邀请码并线下发送；审批；停用（立即撤销会话）；生成重置链接并线下转交。
- 数据边界：存什么（账号、同意记录、目标）、不存什么（明文密码、明文令牌、招聘网站账号与 cookie）、日志字段白名单；导出与删除的范围；D1 时间回溯备份保留期内已删除数据仍存在，保留期结束后才消失；管理后台不提供查看用户私人内容的功能。
- 撤销访问：停用账号、吊销 Access 访问、轮换 `ADMIN_BOOTSTRAP_TOKEN`（如曾重新设置）。
- 后续阶段（1b、1c）将引入 R2、DeepSeek、搜索服务与浏览器节点，届时更新本文档与同意条款版本。

- [ ] **Step 1: 写文档**
- [ ] **Step 2: 检查** —— `npm run lint` 通过；文档中无真实邮箱、域名、ID 或密钥（`grep -nE "@[a-z0-9-]+\.(com|cn|hk)" docs/platform/OPERATIONS.md` 无输出）。
- [ ] **Step 3: 提交** —— `docs(platform): 私有平台运维与数据边界说明`

---

## 计划之外、留给后续计划

- 阶段 1b：简历上传（R2）、DeepSeek 模型接口层、档案草稿与确认、来源层 L1–L4、搜索 API、Queues、机会评估与清单（将扩展 `USER_TABLES`、`forUser` 与 `CONSENT_VERSION`）。
- 阶段 1c：浏览器节点协议、绑定与令牌、L5 任务。
