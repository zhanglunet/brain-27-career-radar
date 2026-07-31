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
