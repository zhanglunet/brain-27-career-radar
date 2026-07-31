# 部署记录

## 2026-08-01 · 自动更新 P0

- Cloudflare 账户：`Zhanglu.net@gmail.com's Account`
- Worker：`brain-27-career-radar`
- 发布前线上版本：`9fcd14d3-4154-4a83-bf39-7caf0c87aa4e`
- 新建 D1：`brain-27-career-radar`
- D1 ID：`fce9ad22-2f4a-449a-98b0-08e8ec59f7ff`
- D1 区域：APAC；远程验证由 KIX 主库响应
- 远程迁移：`0000`、`0001`、`0002` 全部成功
- 远程数据：15 个来源、14 个机会、5 个机构
- Worker 本地启动分析：bundle 1374.46 KiB，gzip 304.50 KiB，采样活动时间 9.9 ms
- 发布配置保护：有生产 D1 ID 时不输出本地 `preview_database_id`，避免 dry-run 和发布绑定混淆

### 正式部署

- Worker 版本：`e2d1770a-f848-4bef-bafd-f530cba6c0d9`
- URL：`https://brain-27-career-radar.zhanglu-net.workers.dev`
- Worker 启动时间：17 ms
- Cron：`0 1 * * *`，即每日 UTC 01:00 / 日本时间 10:00
- 版本处理器：`fetch`、`scheduled`
- 版本绑定：D1 `fce9ad22-2f4a-449a-98b0-08e8ec59f7ff`、Images、Assets

### 线上验收

- 首页 HTTP 200。
- `/api/radar` 在边缘发布传播窗口内首次请求短暂 404，随后稳定返回 HTTP 200。
- API 返回 `dataOrigin=database`、14 个机会、5 个机构、`syncStatus=not_run`。
- Chrome 实际页面完成 hydration：徽标 `DATA`、文案“数据库快照”、14/14 机会卡。
- 页面自身没有浏览器 error/warning；观测到的告警均来自用户浏览器扩展，与站点无关。
- 首次生产 Cron 尚未到执行时间，因此 `sourceVerifiedAt` 暂为空；下次执行后应切换为 `LIVE` 或 `PARTIAL`。

### 受控 scheduled 复核

- 时间：2026-08-01 08:46 日本时间。
- 方法：本地 Worker 使用显式远程 D1 绑定，调用与生产相同的 `scheduled` 处理器。
- 结果：15 个来源全部成功，0 个变化、0 个失败；D1 写入运行记录、15 个基线快照和来源验证时间。
- 边界：该验证证明处理器、D1 和来源网络链路正常，但不是 Cloudflare 时钟自动触发；日本时间 10:00 后需确认出现下一条运行记录。
- 审计修正：受控运行最初由 `scheduled` 处理器按 `cron` 写入，复核后将该条运行的 trigger 更正为 `test`，避免与 Cloudflare 时钟触发混淆。

### 系统说明与 PRD 网页发布

- Worker 版本：`0144a8dc-cffd-43d8-9463-d930405cdcbb`
- 发布结果：D1 `DB`、Images、Assets 绑定正常；Cron `0 1 * * *` 已重新部署。
- 新增入口：`/system`、`/prd`、`/api/system-status`。
- HTTP 验收：首页、两个说明页、雷达 API、状态 API 均返回 200。
- 状态 API 验收：15 个来源、14 个公开机会、5 个机构、15 个快照、0 个失败来源、0 个待审核项。
- 浏览器验收：系统页与 PRD 页正常渲染；系统页 hydration 后显示 D1 正常、15/15 来源成功和下次日本时间 10:00 运行。
