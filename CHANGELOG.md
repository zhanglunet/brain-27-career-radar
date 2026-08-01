# Changelog

## Unreleased

### Added

- `/ai-companies` 全球大模型公司雷达与 `/api/ai-companies`，覆盖 18 家重点公司、官方招聘源健康和已核验机会。
- OpenAI、Google DeepMind、Anthropic、Meta、Microsoft、Amazon、xAI、Mistral、DeepSeek、Kimi、GLM、通义、混元、字节跳动 Seed / 豆包、文心、盘古、MiniMax、阶跃星辰官方来源。

- `/calendar` 统一时间表：开放日、截止日、提前准备任务，以及确认/预计/滚动/待确认日期状态。
- `/knowledge-graph` 论文、导师、研究方向、机构与机会事实图谱。
- `/beijing` 北京高校、重点实验室、中科院研究所和相关机会目录。
- 论文中英文标题与摘要、Workers AI 有界异步翻译和 D1 翻译状态。
- P2.3 PRD 文档及网页版 `/prd/knowledge-graph`。
- `/map` 全球机会分布地图，以及上海、深圳、英国、爱尔兰和中国香港五个区域生态页。

- 根域名 `openagent.hk`、`www.openagent.hk` 与 `radar.openagent.hk` 的版本化 Custom Domain 配置。
- 学术同步可按提供方子集执行，便于对被限流的数据库做有审计记录的恢复同步。
- arXiv、PubMed、PMC、DOAJ 四个自动论文发现适配器。
- PMCID 存储、跨库去重、NCBI 限速与多导师共同署名保护。

- 论文数据库目录、提供方 API、逐数据库同步日志和论文多来源关系。
- Europe PMC 自动发现适配器，以及 DOI/PMID 跨数据库合并。
- CORE、PMC、DOAJ、OALib、东壁等附件数据库的接入状态与配置说明。

- P2 学术情报 PRD 与网页版 `/prd/academic`。
- 16 位重点导师、官方主页来源及导师身份/来源关系模型。
- Crossref 近期论文候选发现、DOI 去重、作者/主题匹配和学术同步审计日志。
- `/researchers`、`/papers` 与对应只读 API。

- 自动更新 PRD、架构决策与开发日志。
- D1 情报数据模型、迁移以及 15 个来源、14 个机会和 5 个机构的种子数据。
- 每日 Cloudflare Cron 来源巡检：有界读取、超时、条件请求、哈希快照、失败保留和审核队列。
- `/api/radar` 动态只读接口和前端静态快照降级。
- 结构化 Worker 日志、同步运行记录、绑定类型生成和生产部署预检。
- 来源巡检成功、内容变化和连续失败测试。
- `/system` 实时系统运行说明、`/prd` 网页版需求文档和 `/api/system-status` 聚合状态接口。
- P1 六阶段开发计划、功能清单、试点来源与量化验收门槛。
- P1 候选记录、字段证据和变更集数据模型及 D1 迁移。
- 5 个试点来源适配器、同站链接发现、URL 归一去重、字段抽取和风险路由。
- P1 回归样本与真实 scheduled 全链路验证；系统状态接口新增灰度聚合指标。

### Changed

- 全球机会地图改为区域聚合后下钻城市，扩大点选命中区并移除手机端强制横向滚动。
- 大模型公司页面严格区分官方招聘入口和具体已核验机会。

- 通用论文 HTTP 客户端对 `429 Too Many Requests` 遵循 `Retry-After` 并执行有界重试。
- 页面更新时间、机会数、立即行动数和机构数改为数据驱动。
- Cloudflare binding 类型改为由 Wrangler 生成。
- Wrangler 升级至 4.118.0、Cloudflare Vite 插件升级至 1.50.0、Next.js 升级至 16.2.12。
- 主页导航增加系统说明与需求文档入口；PRD 版本推进至 v0.3。
- 状态接口改为不缓存，并将生产主入口绑定到 `radar.openagent.hk`。
- PRD 推进至 v0.4；P1 状态更新为“5 来源灰度观察”，高风险自动发布继续关闭。
