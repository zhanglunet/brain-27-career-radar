# 私有平台运维与数据边界（阶段 1a）

私有平台是一个多用户的求职 / 升学空间：用户受邀注册、经管理员审批后登录，在自己的私有数据空间里记录意向目标；后续阶段会加上简历解析、找机会与浏览器节点。它和公开雷达是**同一仓库里的两个独立部署**。

设计见 [多用户平台设计文档](../superpowers/specs/2026-11-12-multi-user-job-agent-platform-design.md)，阶段 1a 实施计划见 [计划](../superpowers/plans/2026-11-12-platform-phase-1a-accounts-isolation.md)。

## 架构与绑定

| 项目 | 私有平台 | 公开雷达 |
|---|---|---|
| 代码 | `platform/`（纯 Worker，不走 vinext） | `app/`、`worker/`、`lib/` |
| 部署配置 | `platform/wrangler.jsonc` → `dist/platform/wrangler.json` | `vite.config.ts` |
| 数据库 | `PRIVATE_DB`（账号与用户数据，读写）、`PUBLIC_DB`（公开雷达库，**代码层只读**） | `DB` |
| 定时任务 | 无 | 两条 cron |
| 入口 | 只接受 `PLATFORM_HOST`；`workers_dev`、预览 URL 关闭 | 公开域名 |

几条由测试守住的纪律：

- 私有平台永不写公开库：`PUBLIC_DB` 只能在 `platform/data/public-readonly.ts` 中使用，且该文件只有 `SELECT`。
- 用户数据的 SQL 只能写在 `platform/data/`，每条都绑定当前用户 ID；新增含 `user_id` 的表必须登记在 `platform/data/tables.ts`。
- `Host` 不等于 `PLATFORM_HOST` 的请求一律 404，即使有人误开了 `workers.dev` 或预览地址也进不来。
- 非 GET 请求的 `Origin` 必须是 `https://PLATFORM_HOST`。
- 所有响应带 `Cache-Control: private, no-store` 与 `X-Robots-Tag: noindex, nofollow`；`/robots.txt` 禁止全部抓取；没有站点地图。

## 本地开发

```bash
npm run platform:migrate:local
```

```bash
npm run platform:dev -- --var ADMIN_BOOTSTRAP_TOKEN:local-dev-bootstrap
```

用 `http://platform.localhost:8787` 访问（必须用这个主机名，`localhost` 会被主机校验拒绝），先打开 `/setup` 用上面的本地口令创建本地管理员。本地状态保存在 `.wrangler/platform-state/`，已被 Git 忽略。

## 首次部署

> **需要 Workers 付费计划（Workers Paid）。**密码哈希用 PBKDF2-SHA256，每次 10 万次迭代，单次注册、登录或重置都要几十毫秒 CPU，超过免费计划每次请求 10ms 的 CPU 限额，会间歇性报 CPU 超限错误。`wrangler dev` 不限制 CPU，本地测不出这个问题。

1. 在 Cloudflare 创建私有 D1 数据库，记下 ID。公开雷达 D1 的 ID 也要准备好（只读使用）。
2. 在 Cloudflare Zero Trust 为 `<PLATFORM_HOST>/admin*` 建一个 Access 应用，只允许管理员本人的身份访问，记下团队域名与 AUD。
3. 设置环境变量后部署（脚本会先迁移，迁移失败即停止，不会继续部署）：

   ```bash
   PLATFORM_D1_ID=<私有库ID> PUBLIC_D1_ID=<公开库ID> PLATFORM_HOST=<私有平台域名> ACCESS_TEAM_DOMAIN=<团队域名> ACCESS_AUD=<AUD> npm run platform:deploy
   ```

4. 设置初始化口令（自己生成一个足够长的随机串，不要写进仓库或聊天记录）：

   ```bash
   npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN --config dist/platform/wrangler.json
   ```

5. 打开 `https://<PLATFORM_HOST>/setup`，输入口令建立第一个管理员。之后 `/setup` 自动失效。
6. **删除初始化口令**：

   ```bash
   npx wrangler secret delete ADMIN_BOOTSTRAP_TOKEN --config dist/platform/wrangler.json
   ```

## 日常操作

- **邀请用户**：管理页"生成邀请码"。邀请码 7 天有效、只能用一次、只显示一次，请线下发给对方。
- **审批**：用户注册后处于"待审批"，管理员批准后才能登录。
- **停用**：立即生效，该用户的全部会话同时作废；可再启用。
- **忘记密码**：管理页为该用户"生成重置链接"，24 小时有效、只能用一次、只显示一次，线下转交。链接形如 `https://<PLATFORM_HOST>/reset#<重置码>`，重置码放在 `#` 之后，浏览器不会把它发给服务器，所以不会出现在 Workers 访问日志里；页面会自动把它填进表单，以 POST 提交。重置后该用户所有旧会话作废。
- **删除账号 / 拒绝注册**：管理页可删除任意其他用户（待审批的显示为"拒绝并删除"），一次删除其全部数据并作废会话；不能在后台删除自己，也不能删除唯一的管理员。
- 第一阶段不接邮件服务，以上都靠线下转交。
- 不能停用或删除唯一的管理员账号。

## 数据边界

**存什么**：账号（邮箱、密码哈希、角色、状态）、同意记录（版本与时间）、意向目标、会话与邀请码 / 重置令牌的哈希、登录失败记录（邮箱与时间，15 分钟内 5 次失败锁定）、审计日志（只含用户 ID 与动作）。

**不存什么**：明文密码、明文会话令牌 / 邀请码 / 重置令牌、任何招聘网站账号或 cookie。

**日志**：只经 `logEvent` 输出，字段白名单为 `userId`、`targetUserId`、`route`、`status`、`count`、`reason`；邮箱、密码、令牌、表单内容不进日志。

**管理员能看到什么**：用户邮箱、角色、状态、注册日期。管理后台**不提供**查看任何用户目标或其他私人内容的功能。持有 Cloudflare 账号权限的人在技术上仍能直接查询数据库，这一点已写进用户同意条款。

**导出与删除**：

- 用户在"账号"页可下载自己的全部数据（JSON），不含密码哈希与令牌。
- 用户输入密码可永久删除账号：一次事务删除其目标、同意记录、重置令牌、会话、登录失败记录和账号本身；审计日志保留（只含 ID）。
- D1 的时间回溯（Time Travel）备份在保留期内仍含已删除数据，保留期结束后才彻底消失。这一点已写进同意条款。

**同意条款**：用户首次登录必须同意当前版本（`platform/consent.ts` 的 `CONSENT_VERSION`）才能使用目标等功能；未同意也能导出或删除自己的数据。条款内容变化时必须升级版本号，所有用户会被要求重新同意。

## 撤销访问

- 停用账号：管理页"停用"，立即生效。
- 收回管理后台访问：在 Cloudflare Zero Trust 中移除该身份的 Access 授权。
- 若曾重新设置 `ADMIN_BOOTSTRAP_TOKEN`，用完立即删除；它只在库中没有可用管理员时才起作用。

## 后续阶段

阶段 1b 会引入 R2（简历文件）、DeepSeek（解析与匹配）、搜索服务与 Queues；阶段 1c 会引入浏览器节点。届时更新本文档，并升级同意条款版本。
