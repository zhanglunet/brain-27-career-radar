# 项目全面体检报告（2026-08-06）

- 审查对象：BRAIN / 27 全部代码、文档与线上网站（v0.13.0，https://openagent.hk）
- 审查方式：8 个独立视角并行评审——项目文档、采集管线代码、前端页面、API 与数据模型、测试与工程质量、线上网站实测、目标用户旅程、完备性批判
- 本报告是 [P3 申请季行动闭环 PRD](PRD_P3_APPLICATION_SPRINT.md) 的事实依据；所有发现均附代码位置或线上证据

## 1. 总体结论

系统的"抓取—哈希—快照—候选—证据—审核"内核真实可用且工程纪律良好（每次发布有备份哈希与验收留证，候选不冒充已核验，TBA 不伪造日期）。但当前存在三层递进的问题：

1. **生产正在带病运行**：2026-08-02 起 62/110 个启用来源巡检失败，连续 6 天日报"新增机会 0、新增论文 0"，论文同步 126 查 93 败，顶会同步 failed——故障持续 6 天无人察觉，因为系统没有任何主动告警。
2. **情报无法变成公开内容**：全站 20 个 API 全部只读，候选（机构 207、机会 74、政策 127）与待审项（149 条 review、76 个变更集）没有任何程序化出口，"核验后公开"的流程实际停摆，公开机会数自上线后停在 63。
3. **产品止步于"看见"**：面向 2027 秋入学、申请季 2026-11~2027-01 密集截止的目标用户，全库 confirmed 截止日仅 6 条，没有提醒、没有申请跟踪、没有材料要求信息——旅程的"准备材料→联系导师→提交申请→跟踪结果"环节完全空白。

结合申请季只剩约 12 周的时间约束，下一阶段应当是一次**申请季行动闭环冲刺**：先止血（修故障、上告警、自动备份），再保真（复核并补全截止日），然后闭环（提醒 + 申请跟踪 + CLI 审核出口），其余功能冻结。

## 2. 现状盘点

### 2.1 里程碑与规模

- P0、P1.1—P1.15 已开发；P1.6 量化验收（95% 准确率 / <1% 重复率）从未完成，但通用适配器已在 P1.13 提前扩展到全部启用来源，与 PRD 自设门控矛盾（docs/PRD.md:59、79、155 对照 CHANGELOG.md:72）。
- P2.1—P2.5、P2.5.1 已上线；P2.6 审核工作台待开发；P3 仅有 3 行占位描述（docs/PRD.md:91-94）。
- 生产数据（2026-08-06 线上 API 实测）：116 来源 / 63 公开机会 / 58 机构 / 21 导师 / 64 论文（全部 candidate，0 已核验）/ 13 顶会 / 10 政策；两条 Cron 均按时触发。

### 2.2 真自动化与人工依赖的实际边界

- 真自动化：来源巡检状态机（条件请求、哈希、快照、自动观察结案）、6 库论文发现、Workers AI 翻译、政策/顶会/机构候选发现、日报周报月报。
- 实际靠人工/种子：全部被监控 URL 是种子迁移；结构化字段抽取仅覆盖 5 个硬编码试点（lib/p1/adapters.ts:12-18 的 `SOURCE_PROFILES`）；`auto_merge_low_risk` 全库为 0，自动合并代码从不执行（lib/p1/pipeline.ts:70-73）；opportunities 表全库无 INSERT 代码路径，新机会只能手写迁移。
- app/chatgpt-auth.ts 是零引用的死代码，且直接信任 `oai-authenticated-user-*` 明文请求头，无签名校验，公网可伪造——**不能**作为未来写 API 的鉴权。

## 3. 发现清单（按严重度）

### 3.1 紧急（生产故障与数据可信）

| # | 发现 | 证据 |
| --- | --- | --- |
| F1 | 62/110 启用来源巡检失败，20 个来源 lastSuccess 停在 08-02、lastStatusCode 全为 null（网络层失败）；故障起点与 08-02 五个版本连发、来源翻倍到 116 完全重合。首要假设：单次 Cron 调用的子请求超限（fetch + 每来源 5-7 条 D1 语句同计入 1000 上限），需 `wrangler tail` 取证确认 | 线上 /api/system-status、/api/sources；worker/index.ts:56-64；lib/source-monitor.ts:172-195 |
| F2 | 论文同步 93/126 失败、顶会同步 failed（checked 0）；连续 6 天新增机会 0、新增论文 0 | 线上 /api/papers、/api/conferences、/api/reports |
| F3 | 无任何主动告警与自动备份：失败仅 console.error；生产备份只存部署机临时目录；6 天故障靠外部评审才发现 | worker/index.ts:51,62；docs/OPERATIONS.md 无备份/告警章节；DEPLOYMENT_LOG.md 各条目 |
| F4 | 种子 confirmed 截止日绕过了自建证据机制：手写迁移直接置 confirmed，无 field_evidence 行；同批数据已出现幻觉迹象（论文 publicationDate=2027-01 未来日期）。申请季用户信错一个截止日的伤害大于缺数据 | drizzle/0015_nosy_photon.sql:6-14；drizzle/0002_seed_radar.sql；线上 /api/papers |
| F5 | 候选与审核全面积压、零出口：机构候选 207、机会候选 74、政策候选 127、pendingReviews 149、pendingChangeSets 76；全站 0 个 POST 路由，review_queue 除 content_changed 自动结案外无任何 resolve 代码路径 | 线上 /api/discovery、/api/system-status；grep 确认 app/api 无 POST |

### 3.2 高（产品缺口与工程风险）

| # | 发现 | 证据 |
| --- | --- | --- |
| F6 | 用户旅程后半程空白：34 张表全部是情报管线表，无收藏/申请跟踪/通知订阅；日历无 ICS 导出；截止提醒只在用户主动访问时可见 | db/schema.ts 全文；app/api/calendar/route.ts |
| F7 | 申请季核心截止日缺失：confirmed 仅 6 条；牛津/剑桥 gathered field（约 2026-12 上旬）、HKPFS（2026-12-01）、UCL/KCL/爱丁堡各批次、TCD/UCD、IRC GOI（约 2026-10）、CSC 攻博/联培时间线均未覆盖；爱尔兰机会为零；雅思/推荐信/RP 等材料要求字段不存在 | drizzle/ 全文 grep；db/schema.ts:41-72 |
| F8 | drizzle 迁移元数据损坏：journal 21 条缺 idx 2/12 且 0023 未注册，快照停在 0016；下一次 `drizzle-kit generate` 必产出与 0017-0023 冲突的迁移 | drizzle/meta/_journal.json；drizzle/meta/ 目录 |
| F9 | 无 CI/CD：无 .github/ 目录；deploy 脚本不强制 verify；核心编排（academic-monitor、p1/pipeline、scheduled 分发）与 20 个 API 路由零测试；DB 写路径仅用 SQL 字符串断言的 FakeDatabase | package.json:11；tests/ 目录对照 lib/ |
| F10 | 12 个数据页 SSR 只输出"正在载入"壳，叠加 Cloudflare 拦截非浏览器 UA（WebFetch 15/15 全 403），SEO 与无 JS 访客为零；首页 SSR 是 2026-08-01 静态快照（14 条 vs 库中 63 条） | curl 实测各页 HTML；app/page.tsx:43-264,279 |
| F11 | 学术同步子请求与串行耗时随"导师×提供方"线性增长（24×6 库、400ms 间隔双层串行），无预算护栏，是扩容即撞的天花板 | lib/academic-monitor.ts:4-5；worker/index.ts:56-64 |

### 3.3 中（一致性与质量债，宜集中修复）

- 时区口径混乱：calendar 的"今天"用 Asia/Tokyo 计算，北京时间每天 23:00-24:00 会提前一天丢弃当日任务（app/api/calendar/route.ts:27）；页面显示至少 4 种时区口径并存。注意 opportunities.deadline_timezone 是有意的按行设计（含 Europe/London、Asia/Hong_Kong），正确修复是按行时区渲染并显式标注，而非全站硬改为单一时区。
- paper_authors 用 researcher.id 哈希生成 author_order 且带 UNIQUE(paper_id, author_order)，共著导师可能相互覆盖（lib/academic-monitor.ts:156,185）。
- 文档口径漂移：README 同文件导师数 21 vs 16 自相矛盾；机构 53 vs 线上 58；README 缺 /policies 入口；ARCHITECTURE 数据流停在 57 来源时点；两个 ADR-027 重号；P2.3 编号被两份 PRD 指代不同功能；线上 /prd 页脚 v0.14 vs package.json 0.13.0；/system 页静态文案 57 来源 vs 实际 116；CHANGELOG 全部堆在 Unreleased 与 v0.2.0-v0.13.0 标签脱节。
- API 约定不统一：papers/researchers 硬 LIMIT 100 静默截断无分页；三种分页模式、两种缓存策略、中英混杂错误文案并存；LIKE 通配符未转义；search 全表 LIKE 无 FTS。
- 日志类表（source_check_logs、source_snapshots、academic_events、*_sync_runs）无 TTL 无限增长；system-status 每次请求约 30 条 COUNT(*) 且 no-store。
- 前端：桌面导航每页手写、链接子集互不一致（首页 20 个裸 `<a>`，子页 4-7 个）；GlobalSearch 缺 conference/policy/project/topic 4 类中文标签；OpportunitiesExplorer 已有数据时错误被静默吞掉；筛选状态不写 URL；hero 统计数字多处硬编码已漂移；日历中 7 条过期截止未归档；13 个顶会中 8 个无任何日期条目。
- 合规缺位：无 LICENSE、无隐私/免责/联系页；抓取不读 robots.txt、同 host 无最小间隔；公开转发 21 位学者个人信息与出版商摘要中译无政策说明；运维内情端点（/api/logs、/api/system-status、/api/discovery）公开无鉴权。
- 成本零监控：Cloudflare 套餐、D1 rows-read、Workers AI neurons 用量无文档无告警——额度耗尽也是 F1 未被排除的故障假设之一。

## 4. 值得肯定的部分

- 可审计性设计（快照、逐来源日志、证据链、风险路由）在同类个人项目中罕见地完整；候选/公开隔离、受控测试标记 `trigger=test`、失败不清空旧数据等诚实性边界得到一贯执行。
- 已覆盖的纯函数测试质量高（source-monitor 状态机 5 条路径、6 个论文适配器含 429 重试、P1 抽取降噪回归）。
- 全部 SQL 使用参数绑定 + 枚举白名单，未发现注入风险；手机导航与全局搜索闭环完整。

## 5. 结论与去向

本次体检的全部发现已按"12 周申请季"约束裁决为下一阶段范围，见 [PRD_P3_APPLICATION_SPRINT.md](PRD_P3_APPLICATION_SPRINT.md)：P3.0 止血 → P3.1 数据保真 → P3.2 行动闭环 → P3.3 审核出口（CLI）→ P3.4 工程与一致性，同时明确冻结 SEO/多用户/地图/图谱/翻译扩展等与申请季无关的投入。
