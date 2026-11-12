# 私有平台运维与数据边界（阶段 1a）

私有平台是一个多用户的求职 / 升学空间：用户受邀注册、经管理员审批后登录，在自己的私有数据空间里记录意向目标；后续阶段会加上简历解析、找机会与浏览器节点。它和公开雷达是**同一仓库里的两个独立部署**。

设计见 [多用户平台设计文档](../superpowers/specs/2026-11-12-multi-user-job-agent-platform-design.md)，阶段 1a 实施计划见 [计划](../superpowers/plans/2026-11-12-platform-phase-1a-accounts-isolation.md)。

## 架构与绑定

| 项目 | 私有平台 | 公开雷达 |
|---|---|---|
| 代码 | `platform/`（纯 Worker，不走 vinext） | `app/`、`worker/`、`lib/` |
| 部署配置 | `platform/wrangler.jsonc` → `dist/platform/wrangler.json` | `vite.config.ts` |
| 数据库 | `PRIVATE_DB`（账号与用户数据，读写）、`PUBLIC_DB`（公开雷达库，**代码层只读**） | `DB` |
| 文件存储 | `RESUMES`（私有 R2 桶 `job-agent-platform-resumes`，存简历文件） | 无 |
| 大模型 | `AI`（Workers AI，只用于把简历转成文本）、DeepSeek API（Secret `DEEPSEEK_API_KEY`） | `AI`（论文翻译） |
| 搜索 | 博查 Web Search API（Secret `BOCHA_API_KEY`） | 无 |
| 队列 | `FIND_QUEUE`（Cloudflare Queue `job-agent-platform-find`，找机会运行） | 无 |
| 定时任务 | 一条 cron `0 0 * * *`（北京时间 08:00 每日刷新找机会） | 两条 cron |
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
   再创建 R2 桶 `job-agent-platform-resumes`：**不要开启公共访问，也不要绑定自定义域名**，文件只经平台鉴权后的路由下载。

   ```bash
   npx wrangler r2 bucket create job-agent-platform-resumes
   ```

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

7. 设置 DeepSeek API key（只放 Secret，不写进仓库、聊天记录或环境变量文件）：

   ```bash
   npx wrangler secret put DEEPSEEK_API_KEY --config dist/platform/wrangler.json
   ```

   没有设置时，生成档案草稿会提示"智能体暂不可用"，其他功能照常。Workers AI 绑定无需额外配置。

8. 创建找机会队列，并设置博查 API key（同样只放 Secret）：

   ```bash
   npx wrangler queues create job-agent-platform-find
   ```

   ```bash
   npx wrangler secret put BOCHA_API_KEY --config dist/platform/wrangler.json
   ```

   没有设置时，找机会的运行会以"智能体或搜索服务未配置"失败结束。队列要在部署前创建，否则部署会因找不到队列而失败。

## 日常操作

- **邀请用户**：管理页"生成邀请码"。邀请码 7 天有效、只能用一次、只显示一次，请线下发给对方。
- **审批**：用户注册后处于"待审批"，管理员批准后才能登录。
- **停用**：立即生效，该用户的全部会话同时作废；可再启用。
- **忘记密码**：管理页为该用户"生成重置链接"，24 小时有效、只能用一次、只显示一次，线下转交。链接形如 `https://<PLATFORM_HOST>/reset#<重置码>`，重置码放在 `#` 之后，浏览器不会把它发给服务器，所以不会出现在 Workers 访问日志里；页面会自动把它填进表单，以 POST 提交。重置后该用户所有旧会话作废。
- **删除账号 / 拒绝注册**：管理页可删除任意其他用户（待审批的显示为"拒绝并删除"），一次删除其全部数据并作废会话；不能在后台删除自己，也不能删除唯一的管理员。
- 第一阶段不接邮件服务，以上都靠线下转交。
- 不能停用或删除唯一的管理员账号。

## 数据边界

**存什么**：账号（邮箱、密码哈希、角色、状态）、同意记录（版本与时间）、意向目标与确认过的目标画像、简历文件（R2，键为 `<用户ID>/resumes/<简历ID>`）与其元数据、档案（当前版本与历史版本）、档案草稿、每日大模型用量、会话与邀请码 / 重置令牌的哈希、登录失败记录（邮箱与时间，15 分钟内 5 次失败锁定）、审计日志（只含用户 ID 与动作）。

**不存什么**：明文密码、明文会话令牌 / 邀请码 / 重置令牌、任何招聘网站账号或 cookie。

**日志**：只经 `logEvent` 输出，字段白名单为 `userId`、`targetUserId`、`route`、`status`、`count`、`reason`；邮箱、密码、令牌、表单内容不进日志。简历文本、提示词与模型输出也一律不进日志，只记调用次数、token 数、耗时和错误种类。

**简历与大模型的数据流**：

1. 用户上传 PDF 或 Word 简历（单个不超过 5 MB，每人最多 3 份），平台只认文件头，伪装的文件会被拒绝。文件存进私有 R2。
2. 用户要求整理草稿时，平台从 R2 取出文件，交给 Workers AI 转成文本。转换在 Cloudflare 内完成，传给转换服务的文件名统一为 `resume.pdf` / `resume.docx`。
3. 简历文本（截断到 2 万字）和意向描述发送给 DeepSeek 整理成草稿。材料放在分隔标签里，并要求模型忽略材料中的任何指令；模型输出会被严格清洗（未知字段丢弃、超长截断、没写的事实留空）。
4. 草稿必须由本人逐项核对并确认后才成为"当前档案"；确认过的每一版都保留，可以恢复上一版。

**每日额度**：每个用户每天（按北京时间）最多调用大模型 30 次、共 15 万 token；调用一旦发出就计 1 次（失败也计），成功后再计 token。超出后当天不能再生成草稿。调整数值改 `platform/llm/quota.ts` 中的 `LLM_DAILY_CALLS` 与 `LLM_DAILY_TOKENS`。

**找机会的数据流**：

1. 用户点"找机会"（或每天 08:00 自动刷新，只针对账号正常、已同意当前条款、目标已确认画像、当天还没跑过的目标）时，只把一条运行记录放进队列；真正的工作在队列消费者里完成。同一目标同时只能有一个排队或进行中的运行，卡住超过 30 分钟的视为失败。
2. 智能体根据目标画像和档案里的学历、专业、技能生成最多 5 条检索词，**发送给博查**。检索词不含姓名；含档案姓名的检索词会在代码里被剔除。
3. 来源分四层：L1 公开雷达（只读）与管理员审核过的共享来源；L2 搜索找到的官方页面；L3 用户自己添加的网址；L4 聚合平台（牛客、实习僧、BOSS 直聘、智联、前程无忧、猎聘、拉勾、LinkedIn、应届生、看准）——**只记链接、不抓取**，页面上标"来自聚合平台，待官方确认"。
4. 抓取只读公开页面：拒绝内网地址与 IP 字面量（重定向的每一跳都检查），遵守目标站 robots.txt，单页不超过 2 MB，只接受 HTML 和纯文本，请求头如实写明 `JobAgentPlatform/1.0`。页面与 robots 缓存 24 小时，缓存表是平台级的，只存公开页面内容。
5. 页面先过防注入扫描，可疑页面**不送给大模型**，相关机会标"页面含可疑内容，已跳过"。
6. 大模型从页面抽取机会后，代码会校验：截止日期必须能在页面原文中找到，否则显示"截止日期未披露"；要求必须是页面原文，改写过的丢弃；机会链接必须是页面本身或页面里出现过的链接。
7. 资格判定只有"满足 / 不满足 / 未知"，判"满足"或"不满足"必须引用档案原话作依据，否则改为"未知"。
8. 共享来源：用户点"允许分享"后进入管理员审核；审核列表与共享来源表**不存提名人身份**，管理员只看到网址和机构名。

**找机会的额度与预算**：每个用户每天最多搜索 20 次（`platform/search/quota.ts` 的 `SEARCH_DAILY_LIMIT`）；单次运行最多 5 条检索词、抓取 12 个页面、评估 15 条机会（`platform/find/run.ts` 的 `MAX_PAGES`、`MAX_ASSESS`，检索词数在 `platform/find/queries.ts`）。一次运行通常要 10–15 次大模型调用，按每日 30 次的大模型额度，每人每天大约能跑一到两次；额度用完时运行会提前结束未执行的步骤并照常完成。

**管理员能看到的运行信息**：最近 50 次运行的用户邮箱、目标 ID 前缀、触发方式、状态、页面数 / 机会数 / 评估数与耗时。不显示检索词、机会内容或来源网址。

**管理员能看到什么**：用户邮箱、角色、状态、注册日期。管理后台**不提供**查看任何用户目标或其他私人内容的功能。持有 Cloudflare 账号权限的人在技术上仍能直接查询数据库，这一点已写进用户同意条款。

**导出与删除**：

- 用户在"账号"页可下载自己的全部数据（JSON），不含密码哈希与令牌。
- 用户输入密码可永久删除账号：先删除 R2 中该用户前缀下的全部简历文件，再一次事务删除其目标、档案、草稿、简历记录、用量、同意记录、重置令牌、会话、登录失败记录和账号本身；审计日志保留（只含 ID）。R2 删除失败时不会删除数据库，可以重试。管理员在后台删除账号走同样的流程。
- 导出包含档案（当前与历史版本）、草稿、目标画像、简历的元数据、目标来源、找机会运行（含统计）、个人机会（含评估）与每日用量；简历文件本身请在"我的档案"页逐份下载。删除目标会同时删除该目标的来源、运行与机会。
- D1 的时间回溯（Time Travel）备份在保留期内仍含已删除数据，保留期结束后才彻底消失。这一点已写进同意条款。

**同意条款**：用户首次登录必须同意当前版本（`platform/consent.ts` 的 `CONSENT_VERSION`）才能使用目标等功能；未同意也能导出或删除自己的数据。条款内容变化时必须升级版本号，所有用户会被要求重新同意。

## 撤销访问

- 停用账号：管理页"停用"，立即生效。
- 收回管理后台访问：在 Cloudflare Zero Trust 中移除该身份的 Access 授权。
- 若曾重新设置 `ADMIN_BOOTSTRAP_TOKEN`，用完立即删除；它只在库中没有可用管理员时才起作用。

## 后续阶段

阶段 1b-1 引入了 R2、Workers AI 与 DeepSeek，阶段 1b-2 引入了博查搜索、Queues 与每日定时任务；同意条款 v1 已写明"检索词会发给第三方搜索服务"，无需升级版本。阶段 1c 会引入浏览器节点，届时更新本文档，并视条款变化升级同意条款版本。
