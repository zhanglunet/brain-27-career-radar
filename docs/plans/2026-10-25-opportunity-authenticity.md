# PRD-176/T1：真实性字段与三态（可信/待验证/可疑）规范

> trend issue #880。对应 PRD-176（中央仓库 zhanglunet/trend）。
> 地位：T1 规范稿——真实性字段与三态规范评审通过后，T2（独立复核 agent 编排与交叉源规则，#881）、T3（机会列表展示复核状态，#882）、T4（与 PRD-175 批准门联动：可疑默认不可投，#883）、T5（验收，#884）均以本文为准；实现不得擅自增删状态枚举、信号码与字段。
> 借鉴声明：[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)（MIT，许可证已实测）——复用「三态结论 + 独立复核」形态。落地文件如直接引用其结构，按仓库现行 Adapted-from 惯例（同 `lib/local-apply/posting-guard.ts` 文件头）保留 "Adapted from cloudflare/security-audit-skill (MIT License), Copyright (c) Cloudflare" 与仓库链接。本文为自研表述，不拷贝代码。

求职场景最大的隐性风险不是"找不到机会"，而是"把假的当成真的"：假岗位、过期信息、冒名机构。本设计给机会信息加一道**数据质量门**：公司/薪资/联系方式由独立复核交叉验证，产出三态结论挂在机会上，展示可见、投递前可引用（与 PRD-175 批准门联动）。本设计只定「字段长什么样、三态怎么判、谁来复核」，不写实现。

## 一、现状锚点：两个数据世界与既有核验惯例

| 世界 | 现状（main 实测） | 与真实性门的关系 |
|---|---|---|
| 云端 D1 | `db/schema.ts` opportunities 表已有核验惯例：`fundingVerifiedAt`、`sourceVerifiedAt`、`deadlineStatus`（confirmed/estimated/rolling/unknown/closed 五态枚举）、`sources.trustLevel`；`candidateRecords`（state observed/review/published/rejected）+ `fieldEvidence`（fieldName/fieldValue/excerpt/extractor/confidence）是现成证据链底座 | 真实性结论的 evidence_refs 直接指向 field_evidence，不另起证据体系 |
| 本地 `lib/local-apply` | `MatchOpportunity` 缓存（`cli.ts` sanitizeOpportunity 白名单：id/title/org/type/region/funding/deadline/body/keywords/mentors/requirements）；`posting-guard.ts` 五类 flag（hidden_block/instruction_like/invisible_tamper/hidden_url/homoglyph） | 现成的"可疑信号源"：guard flag 并入 signals（§三）；本地缓存只读继承云端结论（§2.3） |

PRD-176 把"真实性"从**隐式**（要看 sourceVerifiedAt 才知道核没核过）升级为**显式**字段 + 三态。方向纪律：云端 D1 为权威源；本地只读继承 + 本地正文扫描增量（本地永不写云，PRD-080 数据边界不变）。

## 二、真实性字段（authenticity）

### 2.1 云端 opportunities 表新增三列（T2 落 D1 迁移）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `authenticity_state` | TEXT | NOT NULL DEFAULT 'unverified'，enum：`unverified / trusted / pending / suspicious` | 复核结论主列（可索引筛选） |
| `authenticity_json` | TEXT | NOT NULL DEFAULT '{}' | 结构化结论载体（§2.2），与主列冗余以保证 JSON 自包含 |
| `authenticity_checked_at` | TEXT | 可空，ISO 8601 | 最近一次复核时间 |

索引：`opportunities_authenticity_idx` on `(published, authenticity_state)`。

**unverified 为何单列（第五态，非三态之一）**：存量 63 条公开机会没有复核记录，若并入 pending 会把"未复核"冒充成"复核中"——违反诚实标注精神。展示口径：unverified 灰色"未复核"，pending 琥珀"待验证/复核中"（§3.3）。三态（可信/待验证/可疑）是**复核结论**的值域；unverified 只表示"从未复核"，不参与判定优先级。

### 2.2 authenticity_json 结构（字段级）

| 字段 | 类型 | 说明 | 虚构样例 |
|---|---|---|---|
| `version` | integer | 结构版本 | `1` |
| `state` | enum | trusted / pending / suspicious（与主列冗余，MCP 下发不查库也能读） | `"pending"` |
| `dims` | object | 四维分项：`org`（机构真实性）、`salary_funding`（薪资/资助合理性）、`contact`（联系方式）、`deadline`（截止日有效性）；各维 `{state, reasons[], evidence_refs[]}` | `dims.org = {"state":"trusted","reasons":["域名与官网一致（示例）"],"evidence_refs":["fe-example-001"]}` |
| `signals` | array | `[{code, detail}]`，code 见 §3.1 信号码表 | `{"code":"S4","detail":"隐藏内容命中（示例）"}` |
| `reviewer` | object | `{kind: "agent"\|"human", id}`；agent id 用自命名空间，如 `auth-reviewer@v1`（虚构） | `{"kind":"agent","id":"auth-reviewer@v1"}` |
| `confidence` | integer | 0–100，复核自评置信度 | `70` |
| `override` | object \| null | 人工覆盖记录 `{by, note, at}`（PRD 风险条款"允许人工覆盖但留痕"） | `null` |

`evidence_refs` 指向云端 `field_evidence.id`（本地场景指向快照 excerpt），复核者只看证据原文，不采信上游推断字段（§四）。

### 2.3 本地缓存继承（零破坏）

- `MatchOpportunity` 增加可选 `authenticity?: { state, checkedAt, signals? }`；`sanitizeOpportunity` 白名单追加 `authenticity` 一项（内部只做 state/checkedAt 字符串校验）；
- 缺字段 = unverified，老 `cache.json` 零迁移；
- 本地不产生终审 state：本地 posting-guard 扫描（match/draft 路径已在跑）产出本地 signals，只影响本地展示与本地拦截（draft 拒绝生成，§五）；终审以云端为准，本地 signals 与云端 state 冲突时按更严者**呈现警示**——本地不回写云端，方向纪律不变。

## 三、三态判定规范（信号码 → 状态合成）

### 3.1 信号码表（T1 评审对象）

| 码 | 名称 | 判定输入 | 来源 | 归属维度 |
|---|---|---|---|---|
| S1 | 收费要求 | 正文含"保证金/培训费/押金/先付费"类模式 | 复核 agent 文本规则 | salary_funding |
| S2 | 敏感证件索要 | 要求身份证/护照原件、银行账户等 | 复核 agent 文本规则 | contact |
| S3 | 域名仿冒 | 机会页域名与机构官方域名同形异源（同形字/近似拼写） | posting-guard `homoglyph` + 域名比对 | org |
| S4 | 隐藏内容/指令形行文 | posting-guard `hidden_block` / `instruction_like` / `invisible_tamper` / `hidden_url` 命中 | posting-guard（云端对快照执行同型检测） | org |
| S5 | 薪资异常 | 资助/薪资显著偏离同类机会分布，且伴随 S1 | 复核 agent 统计比对 | salary_funding |
| S6 | 联系方式失配 | 收件邮箱域名与机构官方域名不一致，且官网无佐证 | 域名比对 | contact |
| S7 | 截止日冲突 | deadline 与官方页/历史版本矛盾 | 对齐 `deadline_status` 与 field_evidence | deadline |
| S8 | 源不稳定 | `sources.consecutive_failures` 超阈值、快照缺失 | 采集链路只读指标 | org |

S1–S4 为**硬信号**（诈骗/注入底线），S5–S8 为**软信号**（质量疑点）。

### 3.2 状态合成规则

- **trusted**：四维均无信号，且 `dims.org` 与 `dims.contact` 各有至少 1 条 evidence_refs 支撑，confidence ≥ 80（阈值 T2 可调，T1 定形状）；
- **suspicious**：任一硬信号（S1–S4）命中；或同维两个及以上软信号命中；
- **pending**：其余一切——证据不足、S8 单独命中、复核超时、单个软信号。**默认态落 pending，宁可待验证不误伤**（PRD 风险条款：源不稳定 → 标待验证）；
- 优先级：suspicious > pending > trusted（任一可疑信号压倒一切可信信号）；unverified 不参与合成；
- **人工覆盖**：允许 pending → trusted、软信号 suspicious → pending/trusted，写入 `override{by, note, at}` 并刷新 `authenticity_checked_at`；**硬信号（S1–S4）的 suspicious 不允许人工降级为 trusted**（收费/证件/仿冒/隐藏内容属安全底线，人工只能改判 pending 并附注）——误伤救济走"补充证据重新复核"，不直接改判。

### 3.3 展示口径（T3 依据）

| state | 徽标 | 文案 | 机会列表行为 |
|---|---|---|---|
| unverified | 灰 | 未复核 | 正常展示 |
| trusted | 绿 | 已核验·可信 | 正常展示 |
| pending | 琥珀 | 待验证 | 正常展示 + "建议人工核对"提示 |
| suspicious | 红 | 可疑 | 展示但弱化置灰 + 顶部警示，不进推荐位 |

## 四、独立复核形态（T2 的边界预告）

- **上下文隔离**（借鉴 security-audit-skill 的独立复核形态）：复核与采集是两个独立上下文——复核者输入只有证据原文（快照 excerpt、field_evidence、官方页 URL）与规则集，不读采集链路的推断字段（fit/why 等），结论独立给出；复核与采集不共享中间状态。
- **交叉源规则最小集**（T2 实现清单，T1 只锁输入/输出）：R1 域名一致性（→ dims.org）；R2 机构名一致性（→ dims.org）；R3 邮箱域名比对（→ dims.contact）；R4 资助声明 vs 官方奖学金页（→ dims.salary_funding）；R5 posting-guard 扫描（→ signals）；R6 截止日比对（→ dims.deadline）。每条规则只输出 dim 级 state + evidence_refs，**全局 state 一律由 §3.2 合成**，规则无权直接改全局。
- 编排实现（隔离方式、超时、重试、幂等）与测试是 T2（#881），本节只锁边界，不替 T2 做实现决策。

## 五、展示与联动

| # | 面 | 动作（T2–T4） |
|---|---|---|
| 5.1 | 云端机会列表/详情（`app/opportunities`、`lib/mcp/` summary/detail） | T3 落 §3.3 徽标与筛选；MCP `search_opportunities` 响应加 `authenticity_state` 字段（缺省 unverified，老客户端零破坏） |
| 5.2 | 本地 CLI（`lib/local-apply/cli.ts`） | match/status 输出行尾追加「真实性：待验证（示例）」标注；draft 对本地 signals 含 S1–S4 的机会拒绝生成草稿（文案与现行 guardText 同型：禁止生成草稿，须人工核对来源） |
| 5.3 | 与 PRD-175 批准门联动（T4，#883） | `approval_queue` 入队时校验 opportunity 的 `authenticity_state`：**suspicious 默认拒绝入队**（提示人工 override 后重试）；pending 允许入队但确认界面标注"待验证"。跨 PRD 语义对齐：PRD-175 队列的 `guard_flags` 与本文 `signals` 同构，T4 按 code 对接 |

## 六、样例纪律与下一步

**fixture（T2 建，三态各一条全虚构样例）**：

| fixture | 触发路径 | 关键字段（全虚构） |
|---|---|---|
| `opp-example-trust` | 域名/联系方式与官方一致 → trusted | 机会"某大学脑科学中心科研助理（示例）"，机构页 `https://www.example.edu/careers`，邮箱 `hr@example.edu` |
| `opp-example-scam` | 正文含"押金（示例）"命中 S1 → suspicious | 收件 `billing@example-pay.example`，正文全虚构 |
| `opp-example-pending` | 源连续失败命中 S8 → pending | 快照缺失，confidence 30 |

样例纪律：文档、fixture、测试数据一律虚构（`example.edu` 等占位域）；不出现真实主机名、IP、账号、密钥（PRD 风险条款；T5 含"无真实隐私样例入库"专项）。PRD 非目标重申：不保证 100% 识别诈骗、不骚扰企业电话验证、不存储敏感证件——S 码只降风险不担保。

**版权声明**：借鉴 cloudflare/security-audit-skill（MIT，已实测）——三态与独立复核形态可复用；落地文件如引用其结构，文件头按 `posting-guard.ts` 现行 Adapted-from 惯例保留 MIT 版权声明与来源链接；本文为自研表述，不拷贝代码。

**下一步**：确认后进 **T2（#881）：独立复核 agent 编排与交叉源规则（最小）**——上下文隔离运行、R1–R6 实现、隔离测试（仓库现行 node --test 栈）。

随 T1 确认一并拍板的三个小决策：

1. unverified 是否单列第五态（推荐：单列，避免存量机会被误标"复核中"）；
2. D1 落三列还是单 JSON 列（推荐：三列，state 列可索引筛选）；
3. 硬信号 S1–S4 是否允许人工降级为可信（推荐：不允许，只能改判 pending 并附注）。
