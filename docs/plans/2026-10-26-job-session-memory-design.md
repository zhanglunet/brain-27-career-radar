> **借鉴声明（置顶，验收硬要求）**：本设计只借鉴 [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) 的「会话记忆（session memory）」思路——即跨会话保存结构化状态、新会话开启时先注入「进行中」概览再继续工作。借鉴源 claude-mem 按 **AGPL-3.0** 处理：**只借鉴思路，绝不复用其任何代码、表结构、提示词文本或文案**。本文的实体、字段、状态机、过期规则均为本仓库独立设计，与 claude-mem 实现零代码血缘。若未来需要引用其文字表述，须单独评审并按 AGPL-3.0 义务处理，不得径行摘录。

# PRD-204/T1：求职状态模型设计（目标方向 / 已投递 / 被拒原因 / 进行中状态）

> trend issue #1020。对应 PRD-204（中央仓库 zhanglunet/trend，`adopted/PRD-204-brain-job-session-memory.md`）。
> 地位：T1 规范稿——状态模型评审通过后，T2（状态捕获与更新，#1021）、T3（会话开启续跑注入，#1022）、T4（与 PRD-150 文档生成对接，#1023）、T5（验收试运行，#1024）均以本文为准；实现不得擅自增删实体、字段与阶段枚举。
> 本 PR 为纯加法 .md，无代码。

## 一、定位与边界

### 1.1 一句话定位

求职**状态层**：跨会话连续记录「我要什么（目标方向）、我投过什么（已投递）、为什么被拒（被拒原因）、每件事走到哪一步（进行中状态）」，让每次新会话打开时先续上进行中的状态，而不是从零重述背景。

### 1.2 与 PRD-150 产出物层的划界

| 维度 | PRD-150 产出物层（已有） | PRD-204 状态层（本设计） |
|---|---|---|
| 管什么 | 材料本身：简历 / 求职信 / PS 的字段模型、本地模板、.docx 生成 | 事实与进度：方向、投递事实、拒信归类、每机会当前阶段 |
| 权威副本 | `materials` 表（`~/.brain27/brain27.db`）存草稿正文与版本 | 本设计 §五的五张新表存状态事实；只**引用** materials.id，不复制正文 |
| 读写关系 | 生成时读模板与用户档案 | T4 起 PRD-150 生成时**只读**状态快照（§六 6.3）；状态层不写 materials |
| 生命周期 | 草稿随版本迭代，可覆盖式演进 | 状态只追加事件、迁移留痕（§三），历史不覆写 |

一句话：PRD-150 回答「材料长什么样」，PRD-204 回答「事情走到哪了」。两者同库、互引、互不代写。

### 1.3 与 PRD-175 批准门的关系（不冲突声明）

- PRD-175 管**动作授权**：投递 / 发送等不可逆动作先入批准队列、人确认才执行。本状态层**不发起任何动作**，只在动作发生后记录事实。
- 机会进入「已投递」阶段（§三）的前置条件是存在一条已投递记录（§2.3）；若该投递经由未来自动通道完成，记录中的 `approval_ref` 指向 PRD-175 `approval_queue.id`，可回溯其批准过程；若为用户线下手动投递，`approval_ref` 为空、`channel` 标注渠道即可。
- PRD-176 的真实性三态（可信 / 待验证 / 可疑）与「可疑机会默认不可投」纪律归 PRD-176 管辖；状态层只读引用、不覆写、不绕过。

### 1.4 非目标（明确不做）

1. **不自动投递**：状态层无 send / submit / upload 能力，不新增任何对外发送路径（延续 PRD-080「点下提交的永远是你本人」）。
2. **不复用 claude-mem 代码**：见置顶声明；只借鉴「会话记忆」思路。
3. **不做云端同步**：状态只存本地（§五），云端 D1 零改动、零写入（延续 PRD-080「本地永不写云」）。
4. **不自动改判阶段**：时间流逝只打过期标记（§四），阶段迁移必须来自用户操作或 T2 事件（§三、§六）。
5. **不替代日历 / 截止日系统**：机会截止日以云端情报与 PRD-019 摘要为准，状态层只存快照供过期判定（§2.5 `deadline_snapshot`）。

### 1.5 今天站在哪（main 实测）

| 模块 | 现状 | 与状态层的关系 |
|---|---|---|
| `lib/local-apply/sqlite-store.ts` | materials 表落 `~/.brain27/brain27.db`，库 0600 / 目录 0700 | 状态表**同库新建**（§五），复用打开与权限模式 |
| `lib/local-apply/cli.ts` | 命令面 pull / match / draft / interview / status | 状态读写后续经 CLI 暴露（T2/T3 范围）；本设计只定模型与接口约定 |
| `lib/local-apply/matcher.ts` | T2 匹配评估（权重 方向 0.5 / 导师 0.3 / 条件 0.2，用户已拍板） | 目标方向（§2.2）是匹配输入之一；状态层保存其结构化版本 |
| PRD-175 `approval_queue` / `approval_audit` | 同库新表（设计已定，实现按其 T2） | 已投递记录以 `approval_ref` 引用之（§1.3） |
| 云端机会库 | 机会的权威来源（id、标题、机构、截止日） | 状态层以 `opportunity_id` 引用，标题 / 机构只存**快照**防云端改名后对不上账 |

## 二、状态模型（核心）

模型由四个实体 + 一张事件流水组成：

- **目标方向** `job_targets`：用户当前想要什么（单例当前行 + 历史版本）；
- **机会状态** `opportunity_states`：每个机会当前走到哪个阶段（一行一机会一轮次）；
- **已投递记录** `application_records`：投递事实（一行一次投递）；
- **被拒记录** `rejection_records`：拒信事实与原因归类（一行一次被拒）；
- **状态事件** `state_events`：append-only 流水，记录每一次迁移与标注（审计与 T3 概览的数据源）。

通用约定：所有时间字段为 TEXT、ISO 8601 UTC（如 `2026-10-26T12:00:00Z`）；所有 id 为 TEXT；JSON 字段为 TEXT 存 JSON 文本；「来源」列指明该字段由谁写入——**用户手动**（CLI/UI 录入）、**T2 捕获**（事件落账，见 §六 6.1）、**系统派生**（迁移 / 过期判定时自动写）、**PRD-150 对接**（T4 回填引用）。样例一律虚构（纪律见 §八）。

### 2.2 实体一：目标方向 `job_targets`

当前重点写在这张表里，而不是散落在各次会话的对话中。同一时刻只有一行 `is_current = 1`；修改方向 = 新增一行并把旧行置 0（历史可回溯「我当时想申什么」）。

| 字段 | 类型 | 来源 | 可空 | 说明 | 虚构样例 |
|---|---|---|---|---|---|
| `id` | TEXT PK | 系统派生 | 否 | `targets:{seq}` | `targets:3` |
| `is_current` | INTEGER | 用户手动 / 系统派生 | 否 | 1 = 当前生效行；全表恰一行 = 1 | `1` |
| `directions` | TEXT(JSON 数组) | 用户手动 | 否 | 研究方向关键词，与 matcher 方向维度同语义 | `["认知神经科学","脑机接口"]` |
| `opportunity_types` | TEXT(JSON 数组) | 用户手动 | 否 | 期望机会类型枚举：`phd` / `ra` / `scholarship` / `internship` / `other` | `["ra","phd"]` |
| `institutions` | TEXT(JSON 数组) | 用户手动 | 是 | 偏好机构（名称文本，用户自填） | `["某大学（示例）"]` |
| `mentors` | TEXT(JSON 数组) | 用户手动 | 是 | 偏好导师（姓名文本，用户自填；仅本地保存） | `["示例导师 A"]` |
| `regions` | TEXT(JSON 数组) | 用户手动 | 是 | 偏好地区 | `["英国"]` |
| `focus_note` | TEXT | 用户手动 | 是 | 当前重点的自由文本说明（如本季主攻方向） | `"当前重点：牛津剑桥 RA（示例）"` |
| `focus_opportunity_ids` | TEXT(JSON 数组) | 用户手动 | 是 | 被钉为重点跟进的机会 id 列表 | `["opp-example-001"]` |
| `earliest_start` | TEXT | 用户手动 | 是 | 期望最早到岗（ISO 日期） | `2027-07-01` |
| `notes` | TEXT | 用户手动 | 是 | 其他偏好与约束 | `"优先全额资助（示例）"` |
| `created_at` | TEXT | 系统派生 | 否 | 本行创建时间 | `2026-10-26T12:00:00Z` |
| `updated_at` | TEXT | 系统派生 | 否 | 本行最后修改时间；过期判定基准（§四） | `2026-10-26T12:00:00Z` |
| `confirmed_at` | TEXT | 用户手动 | 是 | 用户最后一次「确认方向仍有效」的时间；与 `updated_at` 分开，避免改个错别字就刷新有效期 | `2026-10-26T12:00:00Z` |

### 2.3 实体二：机会状态 `opportunity_states`

一行 = 一个机会的一轮申请周期。被拒或结束后如重新申请，同机会开新 `cycle`（§三 3.3），旧行保留。

| 字段 | 类型 | 来源 | 可空 | 说明 | 虚构样例 |
|---|---|---|---|---|---|
| `opportunity_id` | TEXT PK(复合) | T2 捕获 / 用户手动 | 否 | 引用云端机会 id（与 materials / approval_queue 同语义，不设硬外键） | `opp-example-001` |
| `cycle` | INTEGER PK(复合) | 系统派生 | 否 | 轮次，从 1 递增 | `1` |
| `title_snapshot` | TEXT | T2 捕获 | 否 | 入账时机会标题快照 | `"某大学脑科学中心科研助理（示例）"` |
| `institution_snapshot` | TEXT | T2 捕获 | 是 | 入账时机构快照 | `"某大学（示例）"` |
| `stage` | TEXT | 用户手动 / T2 捕获 | 否 | 阶段枚举，见 §三：`watching` / `preparing` / `applied` / `interviewing` / `rejected` / `closed` | `preparing` |
| `stage_entered_at` | TEXT | 系统派生 | 否 | 进入当前阶段的时间 | `2026-10-20T09:00:00Z` |
| `deadline_snapshot` | TEXT | T2 捕获 | 是 | 入账时截止日快照（ISO 日期）；过期判定用（§四），权威值仍以云端为准 | `2026-11-15` |
| `last_activity_at` | TEXT | 系统派生 | 否 | 本行最近一次事件时间（迁移、备注、跟进均刷新） | `2026-10-25T18:30:00Z` |
| `next_action` | TEXT | 用户手动 | 是 | 下一步动作备忘（T3 概览直接展示） | `"补一封推荐信（示例）"` |
| `next_action_due` | TEXT | 用户手动 | 是 | 下一步到期日（ISO 日期） | `2026-10-30` |
| `close_reason` | TEXT | 用户手动 / T2 捕获 | 是 | 仅 `closed` 阶段填写：`offer`（录取）/ `withdrawn`（主动放弃或撤回）/ `expired`（机会过期未投）/ `other` | `withdrawn` |
| `created_at` | TEXT | 系统派生 | 否 | 本行创建时间 | `2026-10-18T10:00:00Z` |
| `updated_at` | TEXT | 系统派生 | 否 | 本行最后更新时间 | `2026-10-25T18:30:00Z` |

### 2.4 实体三：已投递记录 `application_records`

投递是事实，一次一行、只追加不修改。机会进入 `applied` 阶段的唯一依据就是本表存在对应行（§三 3.2 规则 2）。

| 字段 | 类型 | 来源 | 可空 | 说明 | 虚构样例 |
|---|---|---|---|---|---|
| `id` | TEXT PK | 系统派生 | 否 | `applied:{opportunity_id}:{seq}` | `applied:opp-example-001:1` |
| `opportunity_id` | TEXT | T2 捕获 / 用户手动 | 否 | 关联机会 | `opp-example-001` |
| `cycle` | INTEGER | 系统派生 | 否 | 对应 `opportunity_states.cycle` | `1` |
| `applied_at` | TEXT | 用户手动 / T2 捕获 | 否 | 实际投递时间（线下投递由用户补录） | `2026-10-22T14:05:00Z` |
| `channel` | TEXT | 用户手动 / T2 捕获 | 否 | 投递渠道枚举：`webform`（官网表单）/ `email`（邮件）/ `portal`（招聘系统）/ `mentor_direct`（导师直联）/ `other` | `webform` |
| `materials_ref` | TEXT(JSON 数组) | PRD-150 对接 / 用户手动 | 是 | 本次投递所用材料版本，引用 materials.id（如 `cv:opp-example-001:v2`）；线下自备材料可为空 | `["cv:opp-example-001:v2","cover_letter:opp-example-001:v1"]` |
| `approval_ref` | TEXT | T2 捕获 | 是 | 若经 PRD-175 批准门执行的投递，指向 `approval_queue.id`；手动投递为空 | `webform_submit:opp-example-001:1` |
| `recipient_note` | TEXT | 用户手动 | 是 | 收件方备注（岗位联系人称谓等；不存邮箱账号等敏感标识） | `"项目协调员（示例）"` |
| `note` | TEXT | 用户手动 | 是 | 自由备注 | `"已收到系统确认页（示例）"` |
| `created_at` | TEXT | 系统派生 | 否 | 落账时间（与 `applied_at` 可不同：补录场景） | `2026-10-22T20:00:00Z` |

### 2.5 实体四：被拒记录 `rejection_records`

被拒是可复用经验，必须落账归类，而不是留在邮箱里。原文原因只存**归类 + 用户摘录的自由文本**，不抓取邮箱内容（状态层不读邮箱）。

| 字段 | 类型 | 来源 | 可空 | 说明 | 虚构样例 |
|---|---|---|---|---|---|
| `id` | TEXT PK | 系统派生 | 否 | `rejected:{opportunity_id}:{seq}` | `rejected:opp-example-001:1` |
| `opportunity_id` | TEXT | T2 捕获 / 用户手动 | 否 | 关联机会 | `opp-example-001` |
| `cycle` | INTEGER | 系统派生 | 否 | 对应轮次 | `1` |
| `application_ref` | TEXT | 系统派生 | 是 | 对应 `application_records.id`；无投递记录的「海投池直接拒」可为空 | `applied:opp-example-001:1` |
| `rejected_at` | TEXT | 用户手动 / T2 捕获 | 否 | 收到拒信（或判定无回复）的时间 | `2026-11-02T09:12:00Z` |
| `reason_code` | TEXT | 用户手动 | 否 | 原因归类枚举：`no_funding`（经费 / 名额原因）/ `fit_direction`（方向不合）/ `fit_background`（背景 / 资历不足）/ `timing`（时间不合）/ `no_reply`（长期无回复，用户判定）/ `unspecified`（拒信未说明）/ `other` | `no_funding` |
| `reason_text` | TEXT | 用户手动 | 是 | 拒信原文要点摘录（用户粘贴或转述；不存整封邮件） | `"名额已分配给内部候选人（示例摘录）"` |
| `lesson` | TEXT | 用户手动 | 是 | 复盘结论，T4 文档生成可引用（§六 6.3），避免在同类机会重复踩坑 | `"下次先邮件确认名额再备材料（示例）"` |
| `created_at` | TEXT | 系统派生 | 否 | 落账时间 | `2026-11-02T10:00:00Z` |

### 2.6 流水：状态事件 `state_events`（append-only）

所有迁移与标注都过这张表，store 层只暴露 append，不提供 UPDATE / DELETE（与 PRD-175 审计纪律一致）。

| 字段 | 类型 | 来源 | 可空 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | 系统派生 | 否 | 追加式流水号 |
| `opportunity_id` | TEXT | 系统派生 | 是 | 关联机会；目标方向类事件为空 |
| `cycle` | INTEGER | 系统派生 | 是 | 对应轮次 |
| `event` | TEXT | 系统派生 | 否 | 枚举：`created` / `stage_changed` / `note_added` / `application_recorded` / `rejection_recorded` / `stale_flagged` / `stale_cleared` / `target_updated` / `target_confirmed` |
| `from_stage` | TEXT | 系统派生 | 是 | 迁移前阶段（仅 `stage_changed`） |
| `to_stage` | TEXT | 系统派生 | 是 | 迁移后阶段（仅 `stage_changed`） |
| `actor` | TEXT | 系统派生 | 否 | `user` / `t2-capture` / `system`（过期打标）/ `prd150-link` |
| `detail_json` | TEXT | 系统派生 | 否 | 事件细节（迁移理由、过期原因等摘要；**不存材料正文**) |
| `occurred_at` | TEXT | 系统派生 | 否 | 事件时间 ISO 8601 |

## 三、状态流转

### 3.1 阶段枚举与状态机

六阶段：`watching`（关注）→ `preparing`（准备中）→ `applied`（已投递）→ `interviewing`（面试中），终态 `rejected`（已拒绝）/ `closed`（已结束）。

```
                 ┌────────────── 暂缓（回退，须留备注）──────────────┐
                 ▼                                                    │
[新建] ──▶ watching ──▶ preparing ──▶ applied ──▶ interviewing ──┬──▶ rejected（终态）
              │            │            │             │          └──▶ closed（终态）
              │            │            │             └──▶ preparing（回退：面试后补材料，须留理由，见 3.2 规则 5）
              │            │            └──▶ rejected（终态，须有被拒记录）
              │            └──▶ closed（终态：放弃准备 / 机会过期）
              └─────────────▶ closed（终态：取消关注）
```

### 3.2 迁移规则

1. **入账即 watching**：机会首次进入状态层（用户钉选或 T2 捕获到关注动作）建行，`cycle = 1`，阶段 `watching`。
2. **preparing → applied 必须有据**：迁移时同一事务内必须存在对应 `application_records` 行；没有投递记录不得进入 `applied`。状态层不执行投递，只验事实。
3. **进入 rejected 必须有据**：迁移时必须存在对应 `rejection_records` 行（含 `reason_code`）；`no_reply` 归类同样算有据，但判定动作必须由用户做出（§四 4.3），系统不自动判拒。
4. **终态不可迁移**：`rejected` / `closed` 行冻结；任何后续变化走新 cycle（3.3）。
5. **回退只有两条合法路径**：`preparing → watching`（暂缓准备）与 `interviewing → preparing`（面试后被要求补材料 / 等通知期间继续完善）。回退必须在 `state_events.detail_json` 留 `reason`，且 T3 概览对发生过回退的机会显式标注「曾回退」，防止把「面试中」误读为单调前进。`applied` 不可回退到 `preparing`——投递已发生是事实，只能向前（等结果 / 被拒 / 撤回走 `closed(withdrawn)`）。
6. **每次迁移必写流水**：`stage_changed` 事件含 from / to / actor / 理由（回退时）；无流水的迁移视为非法，T2 实现须拒绝。
7. **closed 必须带 close_reason**：`offer` / `withdrawn` / `expired` / `other` 四选其一（§2.3）。

### 3.3 轮次（cycle）规则

- 同一机会终态后再次申请（项目重开、新一轮招聘）：新建 `cycle + 1` 行，从 `watching` 起；旧 cycle 的状态、投递、被拒记录全部保留可查。
- T3 概览默认只展示当前 cycle；历史 cycle 折叠为一行摘要（如「上一轮：已拒绝，经费原因」）。
- 是否允许重开 cycle 属用户决策事项（§七 第 5 项），默认允许。

## 四、时间与过期

PRD 风险项：**状态过期误导投递决策**。对策三件套：一切状态带时间戳、过期由规则显式判定、呈现时显式标注。本节定判定规则；呈现格式在 §六 6.2。

### 4.1 时间戳基线

- `job_targets`：`updated_at` + `confirmed_at`；
- `opportunity_states`：`stage_entered_at` + `last_activity_at`；
- 两类事实表：事件时间（`applied_at` / `rejected_at`）+ 落账时间（`created_at`）双记，补录不冒充实时。

### 4.2 过期判定规则（系统派生，只打标不迁移）

| 对象 | 判定条件（默认值，待 §七确认） | 标记 | 含义 |
|---|---|---|---|
| 目标方向 | `confirmed_at`（无则 `updated_at`）距今 > 30 天 | `stale: target` | 方向可能已变，T3 注入时先提醒复核再引用 |
| watching / preparing | `deadline_snapshot` 已过 | `expired: deadline_passed` | 机会本身已截止，建议迁 `closed(expired)`，由用户确认 |
| watching / preparing | `last_activity_at` 距今 > 14 天且未过截止日 | `stale: inactive` | 长期没推进，可能已被其他事项挤掉 |
| applied | 投递距今 > 21 天且无后续事件 | `stale: no_response` | 长期无回音；提示用户考虑跟进或按 `no_reply` 判定（判定权在用户，见 4.3） |
| interviewing | `last_activity_at` 距今 > 7 天 | `stale: interview_quiet` | 面试后无下文，建议跟进 |
| 任意非终态 | `next_action_due` 已过 | `overdue: next_action` | 下一步动作已逾期 |

### 4.3 过期纪律

1. **只打标，不迁状态**：系统（T2/T3 运行时）只写 `stale_flagged` 事件并在呈现层加标记，**永不**因时间流逝自动改 `stage`。阶段只由用户操作或事实事件（投递 / 拒信落账）驱动。
2. **标注必带年龄与依据**：任何过期标注在呈现时必须同时给出「最后更新：N 天前」与触发规则名（如 `no_response > 21d`），不允许只给一个无依据的「已过期」。
3. **判定权在用户**：`no_reply` 被拒、`closed(expired)` 等带判断色彩的落账必须由用户显式确认；系统只提议。
4. **解除要留痕**：用户复核后确认仍有效 → 写 `stale_cleared` 事件并刷新相应的确认时间（如目标方向刷新 `confirmed_at`），不删原打标事件。
5. **终态不过期**：`rejected` / `closed` 行不再参与过期判定，避免概览被历史噪音淹没。

## 五、存储形态建议

### 5.1 推荐：同库新表

在现有 `~/.brain27/brain27.db` 内新建五张表（`job_targets` / `opportunity_states` / `application_records` / `rejection_records` / `state_events`），`CREATE TABLE IF NOT EXISTS` 零迁移，复用 sqlite-store 的打开方式、0600 库文件 / 0700 目录权限与 `BRAIN27_HOME` 覆盖约定。代码落点建议：`lib/local-apply/job-state-store.ts`（T2 实现时定，本设计只定形态）。

### 5.2 理由（对比独立文件方案）

| 维度 | 同库新表（推荐） | 独立文件（如 `job-state.db`） |
|---|---|---|
| 引用一致性 | 与 materials / approval_queue 同库，`materials_ref` / `approval_ref` 可同事务校验 | 跨文件引用只能靠约定，无事务保证 |
| 备份与迁移 | 一个文件即全量本地状态，用户备份 / 换机只带一个文件 | 两个文件易漏备、版本易漂移 |
| 权限模型 | 复用既有 0600/0700，一套纪律 | 需再实现一遍且易不一致 |
| 先例 | PRD-175 批准队列即同库新表，仓库已有共识 | 无先例 |
| 隔离性 | 表级隔离足够（状态表与 materials 互不写对方） | 文件级隔离更强，但本场景无多进程并发写需求，收益低 |

结论：隔离诉求用「表级隔离 + 各 store 只写自家表」满足，不值得为此拆文件。

### 5.3 数据主权

- 状态数据**只存本地** SQLite，永不写云端 D1、永不发任何网络请求（延续 PRD-080 数据边界表：本地 → 云端方向永远为空）。
- 导师姓名、拒信摘录、复盘结论等均属个人数据，只以用户自填文本形式保存在本地库内；日志与概览输出不得包含 `reason_text` 全文（呈现层只出归类与年龄，细节由用户主动展开）。

## 六、与后续任务衔接

### 6.1 T2（#1021）：事件 → 状态映射接口约定

T2 的捕获入口统一为一个事件投递函数（形态约定，实现归 T2）：

```
recordJobEvent(event: {
  kind: "target_set" | "target_confirmed" | "watch_started" | "preparation_started"
      | "application_submitted" | "rejection_received" | "interview_stage_changed"
      | "note_added" | "cycle_reopened" | "closed",
  opportunityId?: string,          // 目标方向类事件为空
  occurredAt: string,              // ISO 8601，事件真实发生时间（可补录）
  actor: "user" | "t2-capture",
  payload: { ... }                 // 按 kind 携带对应实体字段（§二）
}) -> { stateRow, eventId }         // 同事务落实体 + state_events，失败整体回滚
```

映射表（T2 验收以此为准）：

| 事件 kind | 落账动作 |
|---|---|
| `target_set` | 新增 `job_targets` 行并置为 current，旧 current 置 0；写 `target_updated` |
| `target_confirmed` | 刷新当前行 `confirmed_at`；写 `target_confirmed`，清除 target 过期标记 |
| `watch_started` | 建 `opportunity_states` 行（stage = watching）或对既有行写备注；写 `created` |
| `preparation_started` | 迁移 watching → preparing |
| `application_submitted` | 插入 `application_records`；迁移 → applied（规则 3.2-2 同事务校验） |
| `rejection_received` | 插入 `rejection_records`；迁移 → rejected（规则 3.2-3） |
| `interview_stage_changed` | applied → interviewing，或 interviewing → preparing 回退（须带 reason） |
| `note_added` | 更新 `next_action` / `next_action_due` / 备注；刷新 `last_activity_at` |
| `cycle_reopened` | 终态行冻结，新建 cycle + 1 行（stage = watching） |
| `closed` | 迁移 → closed，必填 `close_reason` |

### 6.2 T3（#1022）：会话开启注入概览格式约定

新会话开启时，状态层产出一份**带新鲜度标注**的概览（结构化 JSON + 渲染文本两形态，字段同源）。约定骨架：

```json
{
  "generated_at": "2026-10-26T12:00:00Z",
  "target": {
    "directions": ["认知神经科学"],
    "types": ["ra"],
    "focus_note": "当前重点：牛津剑桥 RA（示例）",
    "age_days": 3,
    "freshness": "fresh"
  },
  "in_progress": [
    { "opportunity_id": "opp-example-001", "title": "某大学脑科学中心科研助理（示例）",
      "stage": "applied", "stage_age_days": 4, "freshness": "stale:no_response",
      "next_action": "发跟进邮件（示例）", "next_action_due": "2026-10-30" }
  ],
  "recent_events": [
    { "at": "2026-11-02T09:12:00Z", "summary": "opp-example-002 已拒绝（原因归类：经费）" }
  ],
  "attention": ["1 个机会投递后 21 天无回音，待判定", "目标方向 3 天前确认，仍有效"]
}
```

约定要点：① 概览必带 `generated_at` 与每条的 `freshness`（`fresh` / `stale:<规则>` / `expired:<规则>`），过期项不删除、不隐藏，只标注（§四）；② 默认只含当前 cycle；③ `recent_events` 默认最近 5 条，来自 `state_events`；④ 渲染文本第一段永远是 `attention`（待处理项），让用户先看到需要决策的事，而不是流水账。

### 6.3 T4（#1023）：与 PRD-150 对接点

| 对接点 | 约定 |
|---|---|
| 读接口 | PRD-150 生成前调只读快照 `getDraftingContext(opportunityId)`：返回当前 `job_targets`（方向 / 机构 / 导师偏好）+ 该机会状态行 + 同机构 / 同方向历史 `rejection_records.lesson` 摘要 |
| 快照语义 | 快照带 `generated_at` 与各部分 `freshness`；过期（如方向 stale）时生成端必须显式提示用户「方向已 40 天未确认，仍按此生成？」，不得静默使用 |
| 写回边界 | PRD-150 只回填引用：投递落账时由 T2 写入 `application_records.materials_ref`；文档生成本身**不写**任何状态表 |
| 拒信经验复用 | `lesson` 只以摘要形式进生成上下文，不进模板、不落进生成的文档正文（避免把复盘文字误投出去） |

## 七、待用户决策事项

随 T1 评审一并拍板；每项给出默认建议，T2 实现按拍板结果落参数，不再另行设计。

1. **「无回音」阈值定多少天？** 背景：RA / 博士岗位回复周期差异大，阈值太短会频繁误报、太长失去提醒意义。默认建议：**21 天**（§4.2 已按此写），仅打标提议判定，不自动判拒。
2. **面试后回退到「准备中」是否允许？** 背景：真实流程存在「面试后被要求补材料、等通知期间继续完善」的情况；但回退会让进度看起来倒退。默认建议：**允许**，但必须留理由并在概览中显式标注「曾回退」（§3.2 规则 5）。
3. **被拒原因归类是否够用？** 背景：§2.5 给了 7 类枚举（含 `unspecified` 拒信未说明、`other`）。默认建议：**先按 7 类上线**，`reason_code` 必填、`reason_text` 可选；用一轮真实拒信后再决定是否扩类，避免一开始枚举膨胀。
4. **目标方向确认周期定多少天？** 背景：方向过期靠 `confirmed_at` 判定，周期太短会频繁打扰确认。默认建议：**30 天**（§4.2 已按此写）；确认动作做成一键（T3 概览内直接确认），成本低。
5. **被拒后是否允许同机会重开轮次（cycle）？** 背景：同一实验室 / 项目隔轮重招常见；禁止重开会逼用户改投新机会条目、丢历史。默认建议：**允许**（§3.3），新 cycle 从 watching 起，历史完整保留，概览默认只显当前轮次。

## 八、样例纪律与下一步

**样例纪律**：本文与后续实现的样例全虚构——机会 `opp-example-001`（「某大学脑科学中心科研助理（示例）」）、导师「示例导师 A」、机构「某大学（示例）」；文档、fixture、测试数据中不得出现真实主机名、IP、账号或密钥（PRD 风险条款；T5 含「无真实隐私样例入库」专项）。

**禁复用重申**：见置顶声明。T5（#1024）验收含「无 claude-mem 代码 / 片段入库」专项检查。

**下一步**：本设计评审通过后进 **T2（#1021）：状态捕获与更新**——按 §二 落五张表、按 §六 6.1 实现事件投递与映射、按 §三 / §四 实现迁移校验与过期打标（仓库现行 node --test 栈）。
