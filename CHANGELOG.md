# Changelog

## Unreleased

### Added

- 自动更新 PRD、架构决策与开发日志。
- D1 情报数据模型、迁移以及 15 个来源、14 个机会和 5 个机构的种子数据。
- 每日 Cloudflare Cron 来源巡检：有界读取、超时、条件请求、哈希快照、失败保留和审核队列。
- `/api/radar` 动态只读接口和前端静态快照降级。
- 结构化 Worker 日志、同步运行记录、绑定类型生成和生产部署预检。
- 来源巡检成功、内容变化和连续失败测试。

### Changed

- 页面更新时间、机会数、立即行动数和机构数改为数据驱动。
- Cloudflare binding 类型改为由 Wrangler 生成。
- Wrangler 升级至 4.118.0、Cloudflare Vite 插件升级至 1.50.0、Next.js 升级至 16.2.12。
