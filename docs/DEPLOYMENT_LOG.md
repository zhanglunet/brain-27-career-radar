# 部署记录

## 2026-08-01 · P1.7 来源目录与历史日志

- 发布前生产版本：`79a270c9-0414-416b-bd3b-ae6f14652338`；先导出 113 KB 远程 D1 SQL 回滚基线到部署机临时目录，未提交 Git。
- 生产自然 Cron 已于 `2026-08-01T01:00:16Z` 自动触发：15/15 来源成功、发现 2 个页面变化、0 失败。这是 Cloudflare 时钟触发的 `trigger=cron` 证据，定时链路已闭环。
- 应用 `0004_nosy_mastermind.sql` 后无待执行迁移；生产来源为 39 个，其中 33 个自动、6 个人工核对，博士/科研 22 个、企业校招 17 个。
- 地区覆盖计数：英国 13、爱尔兰 2、中国大陆 20、中国香港 11；同一跨区域企业入口会计入多个地区。
- 新增 `source_check_logs`、`/api/sources`、`/api/logs`、`/sources` 和 `/logs`。旧 `sync_runs` 保留；逐来源日志从本版本后首次 Cron 开始，发布时为 0 条是预期行为。
- 完整验证通过：TypeScript、ESLint、构建和 13 个测试；全新 D1 从 0000 到 0004 迁移成功；真实本地 Cron 对原 36 个自动候选写入 36 条日志并暴露 3 个不可稳定访问来源，随后将其转为人工核对。
- Dry run 上传体积 1,584.04 KiB / gzip 345.68 KiB；本地启动分析 active 23.7 ms；实际 Worker Startup Time 20 ms。
- 生产版本：`9ff0136d-cfbd-4cc8-be56-8de6cc17bd2a`；D1、Images、Assets 和 `0 1 * * *` Cron 绑定正常，自定义域名保持 `https://radar.openagent.hk`。
- 边缘传播完成后，首页、来源页、日志页、系统页、PRD 页及四个 API 连续 5 轮均返回 HTTP 200；来源 API 返回 39/33/6，系统 API 返回最新自然 Cron。
- 当前待审核共 8 项：2 个 `content_changed`、3 个 `new_source`、3 个 `parse_conflict`；自动合并仍为 0，不会未经审核发布。

## 2026-08-01 · P1 五来源灰度

- 发布前 Worker 版本：`3b714c42-86d7-476f-83b2-7fa9d94adb15`。
- 发布前使用 `wrangler d1 export` 导出远程 D1 SQL 回滚基线到部署机临时目录，未提交 Git。
- 远程迁移预检只显示 `0003_futuristic_inhumans.sql`；迁移成功后确认 `candidate_records`、`field_evidence`、`change_sets` 均存在。
- 5 个试点来源：OPPO 健康机器学习、OPPO 健康算法、清华心理与认知科学系、上海 AI Lab 招聘、BrainCo 招聘。
- 5 个试点的 `discovery_enabled=1`、`adapter_key` 已配置，`auto_merge_low_risk=0`，因此灰度期不会自动写回公开机会。
- 发布前全新本地 D1 真实 scheduled 回放：15/15 来源成功、0 失败；生成 6 个候选、25 条字段证据、6 个待审变更、0 个自动发布。
- 完整质量门通过：TypeScript、ESLint、生产构建及 12 个测试全部成功。
- 新 Worker 版本：`79a270c9-0414-416b-bd3b-ae6f14652338`；启动时间 20 ms。
- 生产绑定：D1、Images、Assets；Cron 保持 `0 1 * * *`；主域名保持 `https://radar.openagent.hk`。
- 线上验收：首页、`/system`、`/prd`、`/api/radar`、`/api/system-status` 全部 HTTP 200；状态 API 为 `Cache-Control: no-store`。
- 发布时生产 P1 聚合数为 5 个试点、0 个候选、0 条证据、0 个待决策；这是首次自然 Cron 尚未执行新代码的预期基线。下一次日本时间 10:00 后核对生产候选与 `trigger=cron` 运行记录。
- P1.6 尚未完成：需执行 7 天抽样观察并达到准确率不低于 95%、重复率低于 1%，之后才可扩展剩余来源或考虑开启低风险自动合并。

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

### P1 规划与 radar.openagent.hk

- 最终 Worker 版本：`3b714c42-86d7-476f-83b2-7fa9d94adb15`
- 自定义域名：`https://radar.openagent.hk`
- 备用入口：`https://brain-27-career-radar.zhanglu-net.workers.dev`
- 发布绑定：D1、Images、Assets；Cron 保持 `0 1 * * *`。
- 状态接口改为 `Cache-Control: no-store`，避免运行触发方式被旧边缘缓存误报。
- Cloudflare 权威 DNS 与 1.1.1.1 已解析 `radar.openagent.hk`；部署机系统解析器曾短暂保留负缓存。
- 使用固定解析直连 Cloudflare 边缘验收：主页、`/system`、`/prd`、`/api/radar`、`/api/system-status` 全部 HTTP 200。
- 网页 PRD 已增加 P1.1—P1.6 开发计划和验收指标。
