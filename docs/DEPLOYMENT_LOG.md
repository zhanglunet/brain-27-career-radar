# 部署记录

## 2026-08-01 · P1.9 科研助理、上海深圳重点与响应式页面

- 首个 P1 功能版本定为 `v0.2.0`，包版本、Git 标签和 GitHub Release 保持一致；发布分支经完整验证后快进合并到 `main`。
- 发布前生产版本：`62ece815-f6c3-4ad5-a53b-14c6f986309d`；先导出 222 KB 远程 D1 SQL 回滚基线到部署机临时目录，未提交 Git。
- 应用 `0007_polite_clint_barton.sql`；生产库现有 57 个来源、51 个自动来源、31 个重点自动来源和 31 个公开机会，其中 9 个科研助理机会均标明硕士可申请。
- 新增牛津、剑桥、UCL、清华、北大、港大、复旦和深圳先进院官方科研助理来源；上海与深圳的高校、研究机构及企业来源统一提升到每 6 小时优先检查。
- 科研助理机会独立于博士和企业研究岗位，结构化记录学历条件与“博士过渡价值”；页面明确该路径可积累实验、数据、论文和推荐信，但不承诺自动转博。
- 本地真实 Worker 对 10 个新增官方来源执行完整网络检查，10/10 返回 HTTP 200、0 失败；该测试使用临时 D1，不写入或冒充生产 Cron 日志。
- 首次发布后浏览器命中旧雷达 API 的 `stale-while-revalidate` 对象，只显示原有 22 个机会；修正为服务端 `Cache-Control: no-store`，客户端使用 `/api/radar?v=p1.9` 并禁用缓存后再次发布。
- 完整验证通过：TypeScript、ESLint、生产构建和 15 个自动化测试。手机 390 px 生产验收显示 9 张科研助理单列卡片、9 段博士过渡说明、卡片宽 339 px、搜索框 16 px，页面宽 375 px 小于视口 390 px；桌面端为三列、平板为两列。
- 最终生产 Worker 版本：`11a5fb39-980f-4b8a-9605-025751e233a9`；D1、Images、Assets、自定义域名和 `0 1,7,13,19 * * *` Cron 绑定正常。
- 首页、来源页、日志页、系统说明、网页 PRD 及四个 API 均返回 HTTP 200；雷达 API 返回 `dataOrigin=database`、31 个机会、9 个科研助理机会和 9 个硕士可申请标记。
- 新增来源将在下一次自然 Cron 到期时建立生产基线；既有生产记录已证明 Cloudflare 自然 Cron 能按时触发，不以受控测试替代自然触发证据。

## 2026-08-01 · P1.8 自动审核、重点院校与博士资助标注

- 发布前生产版本：`9ff0136d-cfbd-4cc8-be56-8de6cc17bd2a`；先导出 136 KB 远程 D1 SQL 回滚基线到部署机临时目录，未提交 Git。
- 应用 `0005_misty_apocalypse.sql` 与 `0006_aromatic_scarlet_witch.sql`；生产库现有 47 个来源、41 个自动来源、14 个高优先级自动来源、22 个机会和 10 个机构。
- Cron 调整为 `0 1,7,13,19 * * *`，即每 6 小时触发一次；普通来源按 24 小时到期检查，牛津、剑桥、UCL、清华、北大等重点来源按 6 小时到期检查。
- 内容变化先进入 `automatic / observing`，下一次检查内容稳定时由 `automatic-policy-v1` 自动通过；自动审核只关闭观察项，不会自动修改或发布机会。新来源、解析冲突和重复失败仍保留人工审核。
- 博士机会新增 `full`、`partial`、`mixed`、`self_funded`、`unknown` 资助类型和官方说明。生产现有博士/联培博士 16 项：全奖 2 项、全奖或部分资助 3 项、待官方确认 11 项。
- 新增或强化 8 个重点博士机会，覆盖 Oxford、Cambridge、UCL 与北大；牛津、剑桥、UCL、清华、北大的来源优先级已进入系统页、来源页和 API。
- 完整验证通过：TypeScript、ESLint、生产构建、14 个测试以及全新 D1 从 `0000` 到 `0006` 的迁移。
- 生产 Worker 版本：`62ece815-f6c3-4ad5-a53b-14c6f986309d`；启动时间 29 ms；上传体积 1,597.37 KiB / gzip 348.42 KiB。
- 首页、来源页、日志页、雷达 API、来源 API、日志 API和系统状态 API 连续 4 轮均返回 HTTP 200。
- 发布后受控调用生产 D1 执行首次检查，26/26 个到期或新来源成功、0 变化、0 失败；该运行已明确标记为 `trigger=test`，不冒充 Cloudflare 自然 Cron。41 个自动来源目前“等待首次检查”为 0。
- 当前审核队列为 2 个自动观察项和 6 个人工待审项。前者将在后续稳定检查时自动关闭，后者涉及新来源或语义/解析判断，仍需人工确认。

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
