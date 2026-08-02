# Changelog

## Unreleased

### Added

- `/policies` 全球科研政策、研究项目与热点议题页面，以及 `/api/policies` 多维筛选 API。
- UKRI、Horizon Europe、EIC、国家自然科学基金、香港 RGC 首批 8 个官方政策源、10 项已核验政策、7 个研究项目和 9 个热点议题。
- 政策 Cron 管线、候选隔离、内容哈希版本历史和结构化同步日志；政策截止进入统一日历，政策/项目/议题进入搜索、报告与知识图谱。
- 政策同步采用独立错峰 Cron 和 4 路有界并发，避免与论文数据库查询共享单次 Worker 子请求额度。

- 全站手机导航：窄屏统一显示菜单按钮、分组入口、当前页面高亮、ESC/遮罩关闭和全局搜索快捷入口。

- 全站全局搜索：支持快捷键唤起，并检索公开机会、机构、导师、论文、信息源和历史情报报告。
- `/search` 完整搜索页、`/opportunities` 全部公开机会清单，以及对应的有界只读 API。
- 机会清单支持关键词、类型、状态、地区、截止状态、博士资助、硕士资格、排序和分页；候选数据继续隔离。

- `/discovery` 持续发现页面与 API：集中查看新校招机会、新公司、新研究机构候选、可信目录健康和最近运行。
- `organization_discovery_feeds`、`organization_candidates`、`organization_discovery_runs` D1 数据模型，以及 UKRI、中科院 5 个首批官方目录。
- Cron 机构发现管线：有界抓取、既有域名排除、URL 去重、证据和首次/最近发现时间。
- 机构名称词形筛选与社交/内容平台排除，防止官方目录的页脚和出版导航成为机构候选。

- `/campus-2027` 2027 校招与研究岗位专项页及 API，覆盖国内外大厂、大模型厂商、中国与英国研究机构。
- 百度、华为、阿里、阿里云、MiniMax 等明确 2027 届机会，以及 Arm 英国下一轮 Graduate / Intern 开放窗口。
- Apple、NVIDIA、微软亚洲研究院与 Alan Turing Institute 等 7 个官方来源和 5 个机构索引。

- `/reports` 情报报告页面与 `/api/reports`：每日新增机会、来源、论文总结，以及历史日报、周报、月报和检索。
- `intelligence_reports` D1 报告快照、历史回填与 Cron 自动刷新器。

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

- 通用招聘列表适配器扩展到所有显式启用的公司、大学和研究机构列表来源；新机会仍需核验后发布。

- 全球机会地图改为区域聚合后下钻城市，扩大点选命中区并移除手机端强制横向滚动。
- 大模型公司页面严格区分官方招聘入口和具体已核验机会。

- 通用论文 HTTP 客户端对 `429 Too Many Requests` 遵循 `Retry-After` 并执行有界重试。
- 页面更新时间、机会数、立即行动数和机构数改为数据驱动。
- Cloudflare binding 类型改为由 Wrangler 生成。
- Wrangler 升级至 4.118.0、Cloudflare Vite 插件升级至 1.50.0、Next.js 升级至 16.2.12。
- 主页导航增加系统说明与需求文档入口；PRD 版本推进至 v0.3。
- 状态接口改为不缓存，并将生产主入口绑定到 `radar.openagent.hk`。
- PRD 推进至 v0.4；P1 状态更新为“5 来源灰度观察”，高风险自动发布继续关闭。
