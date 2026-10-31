# PRD-232/T1：本地求职工作台设计（队列状态机 / 多 agent 分工 / 批准门衔接点）

> trend issue #1160。对应 PRD-232（中央仓库 zhanglunet/trend，`adopted/PRD-232-brain-local-job-workbench.md`）。
> 地位：T1 规范稿——队列状态机、多 agent 权限边界与批准门衔接点评审通过后，T2（任务队列实现，#1161）、T3（多 agent 协作接入，#1162）、T4（批准门衔接与门禁测试，#1163）、T5（验收试运行，#1164）均以本文为准；实现不得擅自增删状态枚举、agent 权限与门禁路径。
> 借鉴声明：nightly-labs/openbot 的许可证**未核实**，本设计只借鉴其「本地工作台 + 任务队列」的产品形态，**不复用其任何代码**；本文状态机、字段与分工均为自研设计。本 PR 为纯加法 .md，无代码。

一句话定位：PRD-175 是金库门——管「不可逆动作能不能放行」；本工作台是营业大厅——管「机会排到哪一步、谁在办、下一件办什么」。大厅怎么排队，都不改变金库门的规则；大厅里任何人想出金库门，必须走门本身的流程。

## 一、定位与边界

### 1.1 工作台是什么

本地、CLI-first 的求职流程承载面，坐在 PRD-080 申请助手（pull/match/draft/interview）与 PRD-175 批准门之上：

- 把「机会」组织成有生命周期的队列条目：待投递 → 跟进中 → 面试准备 → 已拒绝复盘（§二）；
- 把搜集/准备/复盘三类 agent 的活儿分派、回收、留痕（§三）；
- 把一切「投递/发送」语义的动作收拢到**唯一出口**，强制经 PRD-175 批准门放行（§四）；
- 全程留痕，可对账、可复盘（§五）。

形态与现有 `brain27` CLI 一致：命令面扩展一组 `workbench` 子命令（命名见 §七待决策 4），无 GUI、无常驻服务；T2 落地时既有命令零改动（与 PRD-175/T3 接入 cli.ts 的纪律相同）。

### 1.2 与 PRD-175 批准门的划界（门不变）

| 维度 | PRD-175 批准门（既有，本设计只调用） | 本工作台（本设计新增） |
|---|---|---|
| 管的对象 | 不可逆动作的授权与执行：`email_send` / `webform_submit` / `file_export_final` / `profile_share` 四个已注册 action_kind | 机会的生命周期与任务编排：四状态队列、agent 分工、提醒与呈现 |
| 状态机 | 七态：pending / approved / rejected / executed / failed / expired / cancelled | 四主状态 + 终态 closed（§2.1）；两套状态机**互不改写**，只以 approval_id 关联 |
| 决定权 | 人，经 `brain27 approvals` 命令族（T3 已落地） | 工作台**无**决定权：不提供 approve/reject 的替代入口，呈现时只给跳转提示 |
| 执行口 | `lib/local-apply/approval/gate.ts` 的 `execute`，仓库唯一执行口 | 工作台只允许一个 dispatch 出口模块调用门的 request/execute 面（§4.2），自身不实现任何发送/提交 |
| 数据 | `approval_queue` + `approval_audit`（`~/.brain27/brain27.db`） | 同库新增 `workbench_items` + `workbench_events` 两表（§2.3 / §5.2），不动门的表 |
| 审计 | `approval_audit` append-only | `workbench_events` append-only；门侧事件以 approval_id 与门审计对账 |

工作台**不得**做的事（评审红线）：新增 action_kind、修改门的七态与有效期规则、提供绕过 `gate.execute` 的执行路径、在队列条目里复制材料正文（只存 draft_ref 引用，承 PRD-175 §2.2 载荷最小化）。

### 1.3 非目标

- 不改 PRD-175 批准门的任何规则（注册表、七态、72h/24h 有效期、幂等与防重放语义均以 PRD-175/T1 规范及其已合并实现为准）；
- 不做云端协作：无多设备同步、无共享队列、无云端写入（PRD-080「本地永不写云」延续）；
- 不做 GUI / Web 界面（CLI-first；界面是后续事项，不在本 PRD 范围）；
- 不替用户做决定：状态迁移中凡涉及「投不投、跟不跟、弃不弃」的判断点，一律呈现给用户，不由 agent 默认推进（异常迁移见 §2.2，均为用户动作或带留痕的系统动作）。

### 1.4 现状锚点（main 实测）

| 模块 | 现状 | 与本设计的关系 |
|---|---|---|
| `lib/local-apply/cli.ts` | 命令面 pull / match / draft / interview / status + approvals 命令族 | T2 新增 `workbench` 命令族，既有命令零改动 |
| `lib/local-apply/approval/gate.ts` | `createApprovalGate`：requestApproval / preview / decide / cancel / execute / get / list / auditFor / appendAudit | §四衔接只经 requestApproval / preview / execute 三个面；decide/cancel 只归人经 approvals 命令 |
| `lib/local-apply/approval/registry.ts` | 四个 action_kind 已注册，default-deny | §4.1 动作清单全部映射到已注册 kind，不新增 |
| `lib/local-apply/approval-cli.ts` | approvals list/show/approve/reject/cancel（T3 已落地） | 用户在工作台看到 pending 提示后，去 approvals 命令族决定；工作台不复制该入口 |
| `lib/local-apply/sqlite-store.ts` | materials 表，`~/.brain27/brain27.db`，库 0600 / 目录 0700 | 工作台两张新表同库同权限模式 |
| `lib/local-apply/posting-guard.ts` | 机会正文五类 flag，只检测不阻断 | 入队时携带 guard 结论快照；带 flag 的机会在队列中醒目标记（承 PRD-175 §5.5 呈现纪律） |
| PRD-204（求职状态模型，trend #1020） | **并行 T1，尚未落地** | §2.4 只定概念对齐原则，不假设其文件/枚举存在 |

## 二、队列状态机（核心一）

### 2.1 四主状态 + 终态

主状态为 PRD-232 既定的四状态，另设一个终态 `closed` 承接「流程结束」的归档（理由与备选见 §七待决策 1）：

| 状态 | 枚举 | 含义 | 进入条件 | 退出条件 |
|---|---|---|---|---|
| 待投递 | `to_apply` | 机会已入队，材料准备中或已就绪，尚未投递 | 用户手动入队；或搜集 agent 提议、用户确认后入队（§3.1） | 投递经批准门 executed 成功 → `following`；用户放弃 → `closed(withdrawn)` |
| 跟进中 | `following` | 已投递，等待对方回应或推进跟进动作 | `to_apply` 的投递动作在批准门 executed | 收到面试邀约 → `interviewing`；收到明确拒绝 → `rejected`；用户放弃/机构撤销 → `closed`（异常迁移，§2.2）；拿到录用 → `closed(hired)` |
| 面试准备 | `interviewing` | 已约面试，准备与演练期 | `following` 中登记面试邀约（含时间占位信息） | 面试完成 → 回 `following`（等结果）；收到拒绝 → `rejected`；拿到录用 → `closed(hired)`；用户放弃 → `closed(withdrawn)` |
| 已拒绝复盘 | `rejected` | 已被明确拒绝，复盘作业进行中 | 任一非终态收到明确拒绝并登记 | 复盘完成（复盘报告落盘） → `closed(review_done)` |
| 已关闭（终态） | `closed` | 流程结束归档，只读 | 上述各路径 | 终态，不可再迁出；同一机会重新申请 = **新条目**入队（旧条目留痕不动） |

合法迁移全集（不在此列的迁移一律拒绝并写事件，见 §2.2）：

```
to_apply ──投递 executed──▶ following ──登记面试邀约──▶ interviewing
   │                            │  ▲                        │  │
   │                            │  └──── 面试完成 ───────────┘  │
   │                            │                               │
   ├──放弃──▶ closed            ├──拒绝──▶ rejected ◀──拒绝──────┘
   │                            ├──录用──▶ closed(hired)
   │                            └──放弃/撤销──▶ closed（异常迁移）
   └──(rejected 可由 to_apply 之外任一非终态进入：投递后被拒、面试后被拒)

rejected ──复盘完成──▶ closed(review_done)
closed = 终态，无迁出
```

注：`to_apply` 本身不会直接收到「拒绝」（尚未投递，无从被拒）；若机构在投递前撤岗，走 `closed(org_closed)`。

### 2.2 异常迁移与守卫规则

| 情形 | 处置 | 留痕 |
|---|---|---|
| 跟进中直接关闭（用户放弃、机构撤销岗位、长期无回应后用户决定收尾） | 允许 `following → closed`，必须带 `close_reason`（withdrawn / org_closed / no_response 三选一或自由备注） | 事件 `closed_abnormal`，detail 记 reason 与操作者 |
| 面试准备中直接关闭 | 同上（`interviewing → closed`） | 同上 |
| 非法迁移（如 `to_apply → interviewing`、`closed → 任意`、`rejected → following`） | 拒绝执行，状态不变 | 事件 `transition_rejected`，记尝试的 from/to 与来源（cli/agent） |
| 重复入队（同一 opportunity_id 已有非终态条目） | 拒绝新建，返回既有条目 id（幂等，承 PRD-175 防重放哲学） | 事件 `enqueue_duplicate_blocked` |
| 截止日已过仍在 `to_apply` | 不自动迁移、不自动关闭；条目置 `overdue` 标记并在列表醒目呈现，由用户决定关闭或保留 | 标记变化写事件 `overdue_marked` |
| 投递执行 failed（门侧终态） | 条目**留在** `to_apply`，置 `last_attempt_failed` 标记 + 失败摘要；重试 = 新批准请求（承 PRD-175 §3.2），不复活旧请求 | 事件 `dispatch_failed`，detail 记 approval_id 与失败摘要（不记正文） |
| 迁移并发/重复提交 | 状态迁移以「当前状态 + 期望前置状态」做乐观校验，不符即拒绝（防 agent 与用户同时操作打架） | 冲突写 `transition_rejected` |

### 2.3 队列条目数据结构（`workbench_items`，T2 落地）

| 字段 | 类型 | 约束 | 说明 | 虚构样例 |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | `wb:{opportunity_id}:{seq}`，同机会多次入队 seq 递增 | `wb:opp-example-001:1` |
| `opportunity_id` | TEXT | NOT NULL | 关联机会（与 materials / approval_queue 同语义，不设硬外键） | `opp-example-001` |
| `state` | TEXT | NOT NULL DEFAULT 'to_apply' | 枚举见 §2.1 五值 | `to_apply` |
| `state_entered_at` | TEXT | NOT NULL，ISO 8601 | 当前状态进入时间（算停留时长/超期判断） | `2026-10-26T09:00:00Z`（示例） |
| `close_reason` | TEXT | closed 时必填 | hired / withdrawn / org_closed / no_response / review_done | `review_done` |
| `match_ref` | TEXT | 可空 | 最近一次 match 评估引用（分数与缺口摘要的出处） | `match:opp-example-001:2026-10-26`（示例形态） |
| `draft_refs_json` | TEXT | NOT NULL DEFAULT '[]' | 已备材料的 materials.id 列表（只存引用） | `["cv:opp-example-001:v2"]` |
| `approval_ids_json` | TEXT | NOT NULL DEFAULT '[]' | 本条目关联的 approval_queue 记录 id 列表（对账键） | `["webform_submit:opp-example-001:1"]` |
| `approval_marker` | TEXT | 可空 | 门侧瞬时标记镜像：approval_pending / approved_pending_execute / last_decision_rejected / last_attempt_failed（§4.3）；**镜像仅供呈现，权威状态以 approval_queue 为准**，呈现前应向门侧校验 | `approval_pending` |
| `next_action` | TEXT | 可空 | 下一步动作描述（用户/agent 维护） | `等待对方回复（示例）` |
| `next_action_due_at` | TEXT | 可空，ISO 8601 | 下一步到期时间（跟进提醒用，只提醒不自动执行，§七待决策 2） | `2026-11-02T09:00:00Z`（示例） |
| `guard_flags` | TEXT | NOT NULL DEFAULT '[]' | 入队时 posting-guard 结论快照（flag kinds 数组） | `["instruction_like"]` |
| `created_at` / `updated_at` | TEXT | NOT NULL，ISO 8601 | 建条/最近变更时间 | — |
| `schema_version` | INTEGER | NOT NULL DEFAULT 1 | 表结构版本 | `1` |

索引：`(state, state_entered_at)`、`(opportunity_id)`。表创建用 `CREATE TABLE IF NOT EXISTS`，零迁移（与 materials / approval 两表同模式）。

### 2.4 与 PRD-204 求职状态模型的关系（概念对齐）

PRD-204（claude-mem 式求职状态模型）是并行 T1，设计时点其枚举与文件均不存在。本设计只定三条对齐原则，T3/T4 对接时按此执行：

1. **单一权威**：机会的「流程状态」（投没投、跟没跟）以本工作台队列为唯一权威；PRD-204 的状态模型若涉及会话记忆/上下文层面的状态（如对话阶段、材料版本上下文），属不同维度，不得与队列状态双写同一字段。
2. **映射而非直用**：若 PRD-204 落地后定义了自己的状态枚举，T3 写一张显式映射表（对方枚举 → 本队列枚举）并单测覆盖，不允许在代码里散落字符串直转。
3. **引用而非复制**：PRD-204 需要呈现队列状态时，读 `workbench_items` 或经工作台查询面，不另存副本（防双写漂移，承 PRD-175 载荷最小化）。

## 三、多 agent 分工（核心二）

### 3.1 三类 agent 的职责边界

| agent | 职责 | 输入 | 产出（落盘才算数） | 明确不做 |
|---|---|---|---|---|
| 搜集 agent（collector） | 从云端只读通道拉取新机会（经 PRD-080 pull 路径）、去重、初筛，**提议**入队 | 来源清单、筛选偏好 | 候选清单（缓存区）+ 入队提议（含 match 初评引用） | 不直接入队（入队须用户确认，§2.1）；不写正式草稿；不碰批准门任何接口 |
| 准备 agent（preparer） | 为 `to_apply` 条目生成/定制材料草稿、面试问题集与演练材料（经 PRD-080 draft/interview 路径） | 条目、档案、缺口分析 | materials 草稿（带 AI 标注，版本化）+ 面试题集；回写条目 `draft_refs_json` | 不发起投递/发送；不调用门的 request/execute；不改队列状态（产出回写引用除外，状态迁移只走 §2.1 合法路径且由工作台执行） |
| 复盘 agent（reviewer） | 对 `rejected` 条目做拒后复盘：时间线还原、缺口归纳、对后续条目的建议 | 本条目全部事件留痕、材料版本、match 记录 | 复盘报告（本地文档/materials 引用）；完成后提议 `rejected → closed(review_done)`（迁移由用户确认触发） | 不改历史事件与审计；不自动重投、不自动新建条目；权重/规则调整只出**建议**，不直接改 matcher 配置 |

### 3.2 任务分配与回收

- **任务对象**：`{task_id, agent_kind, item_id, input_refs, output_refs, status, created_at, finished_at, failure_summary}`；status：`queued / running / done / failed / abandoned`。T3 落地时存同库新表或事件流（T3 定，本设计只定字段语义）。
- **分配**：工作台是唯一调度者。任务只能由工作台（用户命令或工作台规则）创建并派发；agent 之间**不得**互相派活（防失控链式调用），agent 发现后续工作只能在产出里写「建议任务」，由工作台呈现给用户决定。
- **回收**：agent 完成 = 产出已落盘（materials / 复盘报告 / 候选缓存）且任务对象置 done 并写明 output_refs；只在对话里返回文本不算完成。工作台回收时校验产出存在性与引用有效性，校验不过 = failed。
- **呈现**：`workbench` 列表/详情呈现任务状态；用户可随时终止 running 任务（置 abandoned，留痕）。

### 3.3 失败处理

| 失败情形 | 处置 |
|---|---|
| agent 执行报错/超时 | 任务置 failed，写 failure_summary（摘要，不含材料正文）；条目状态**不变**，不自动重试 |
| 重试 | 由用户或工作台规则新建任务（新 task_id），不复活旧任务（承终态不复活哲学） |
| 产出校验失败（引用不存在、格式不符） | 同 failed，摘要注明校验项 |
| 同一 agent 连续失败（阈值 T3 定，默认建议 3 次） | 该 agent_kind 标 `degraded`，工作台停止自动派发并提示用户，改为人工处理；手动派发仍可 |
| agent 试图越权动作（如调用门接口、改状态） | 立即终止任务，写 `agent_boundary_violation` 事件（§5.1），并在 T4 门禁测试中作为用例固化（§4.4 G3） |

### 3.4 agent 权限边界表（评审对象）

| 能力 | 搜集 | 准备 | 复盘 | 用户（人） |
|---|---|---|---|---|
| 读云端只读机会通道 | ✅ | — | — | ✅ |
| 提议入队 / 写候选缓存 | ✅ | — | — | ✅（直接入队） |
| 确认入队（建条目） | ❌ | ❌ | ❌ | ✅ |
| 写 materials 草稿（带 AI 标注） | ❌ | ✅ | ❌（只写复盘报告） | ✅ |
| 写复盘报告 | ❌ | ❌ | ✅ | ✅ |
| 状态迁移（§2.1 合法路径内） | ❌ | ❌ | ❌（只提议） | ✅（工作台执行，用户触发） |
| 发起批准请求 requestApproval | ❌ | ❌ | ❌ | ✅（经 §4.2 唯一出口；agent 提议投递包，人确认后才由出口发起，§七待决策 3） |
| 批准/拒绝 decide | ❌ | ❌ | ❌ | ✅（仅 approvals 命令族） |
| 执行投递/发送 execute | ❌ | ❌ | ❌ | ✅（仅经 §4.2 出口 + 门校验） |
| 改 matcher 权重/规则配置 | ❌ | ❌ | ❌（只出建议） | ✅ |

**总红线：任何 agent 都无权直接投递，也无权调用批准门的任何接口（连 requestApproval 都不行）。** agent 与「投递」之间永远隔着两道人工动作：人确认发起请求、人批准。

## 四、批准门衔接点（核心三，验收要求「明确」）

### 4.1 工作台内全部「投递/发送」语义动作清单（逐个映射）

工作台中凡产生「对外不可逆效果」的动作只有下列六处，每处都必须映射到 PRD-175 已注册 action_kind 并经 §4.2 出口过门；清单外的新增对外动作，未在 PRD-175 注册前一律不存在（default-deny）：

| # | 工作台触发点 | 所在状态 | action_kind（PRD-175 已注册） | draft_ref | 备注 |
|---|---|---|---|---|---|
| D1 | 「投递」：提交申请表/投递包 | `to_apply` | `webform_submit`（A2） | 投递包定稿引用 | 本工作台的主投递路径；executed 成功是 `to_apply → following` 的唯一触发 |
| D2 | 「发送申请/套磁邮件」 | `to_apply` | `email_send`（A1） | 邮件草稿引用 | 邮件通道投递与 D1 互为渠道变体，同门同规 |
| D3 | 「发送跟进邮件」（催询、补充材料、致谢） | `following` / `interviewing` | `email_send`（A1） | 跟进邮件草稿引用 | **最易被当成「不是投递」而绕过——明确在列**；面试后感谢信同此行 |
| D4 | 「导出可投递定稿」（去 AI 标注版 docx） | `to_apply`（亦可在准备期） | `file_export_final`（A3） | 定稿草稿引用 | 处置口径以 PRD-175 为准（T1 登记留痕；其后续拍板若要求入队，工作台只服从，不另定） |
| D5 | 「导出档案分享包」 | 任意非终态 | `profile_share`（A4） | 导出范围载荷 | 同 D4，口径从 PRD-175 |
| D6 | 「重新投递」（failed/rejected 后对同机会再投） | `to_apply`（新条目或原条目收尾后新建） | `webform_submit` / `email_send` | 新草稿引用 | 是**全新**请求+全新批准，不复活任何旧记录（承 PRD-175 §3.2） |

不在清单内、明确**不过门**的动作（防过度拦截）：本地草稿生成与改写、match 评估、面试题生成、复盘报告、状态迁移登记、提醒呈现——均为本地可逆操作，不经批准门，但全部留痕（§五）。

### 4.2 「投递只有一个出口且强制过门」的结构设计

```
┌─ 工作台 ────────────────────────────────────────────────┐
│  队列模块（状态机）   agent 调度   CLI 呈现               │
│        │                 │            │                  │
│        └── 禁止 import 门的 request/execute 面 ──┐       │
│                                                  ▼       │
│                              唯一出口 dispatch（T2/T4）  │
│                                  │ requestApproval     │
│                                  │ preview（dry-run）  │
│                                  ▼                     │
│                        PRD-175 批准门 gate.ts            │
│                                  │ execute（校验：     │
│                                  │  approved 未过期 +   │
│                                  │  载荷未变 + 幂等）   │
│                                  ▼                     │
│                             实际发送/提交通道            │
└──────────────────────────────────────────────────────────┘
   人决定：brain27 approvals approve/reject/cancel（既有命令，工作台不复制）
```

结构规则：

1. **单点收口**：工作台侧只有 dispatch 一个模块允许 import `approval/gate.ts` 的 requestApproval / preview / execute；队列、agent、CLI 呈现模块一律禁止（T4 以静态 import 图断言固化，§4.4 G10）。
2. **两段式**：dispatch 发起请求只产生 pending 记录，**不**连带执行；执行只能在记录为 approved 且未过批准有效期时，由 dispatch 调 gate.execute 完成，门内校验（载荷重算幂等键、有效期）以 PRD-175 实现为准，工作台不重复实现也不得跳过。
3. **预览免费、执行收费**：gate.preview（dry-run）可在发起请求前任意调用，不改任何状态、不算「投递尝试」；真正的状态推进只认 executed 事件。
4. **回执回写**：execute 返回后，dispatch 把 approval_id 追加进条目 `approval_ids_json`，按 §4.3 更新标记/状态，并写 `workbench_events`；门侧 `approval_audit` 与工作台事件以 approval_id 对账。

### 4.3 门的返回结果 → 工作台队列状态变化

| 门侧结果 | 条目主状态 | 条目标记（approval_marker） | 后续 |
|---|---|---|---|
| 请求已入队，pending（待决定） | 不变（`to_apply` 或跟进态） | `approval_pending` + 呈现 approval_id 与过期时点（pending 默认 72h，承 PRD-175） | 用户去 approvals 命令族决定；工作台只呈现，不催办、不自动重发 |
| pending 过期 expired | 不变 | 标记清除，写事件 `approval_expired` | 可重新发起 = 新请求；旧记录终态不动 |
| rejected（人拒绝） | **不变，不自动关闭** | `last_decision_rejected` + decision_note 摘要 | 用户三选一：改稿后重新发起（新请求）/ 放弃 → `closed(withdrawn)` / 保留观望 |
| 用户撤回 cancelled | 不变 | 标记清除 | 同 expired，可重新发起 |
| approved（已批准未执行） | 不变 | `approved_pending_execute` + 批准有效期倒计时（默认 24h，承 PRD-175） | 须在有效期内由 dispatch 调 execute；过期未执行 → 标记清除，**按 expired 处理，须重新批准** |
| executed 成功 | `to_apply → following`（D1/D2 场景）；跟进邮件场景状态不变 | 清除标记，记 execution_ref | §2.1 迁移正式生效；置 next_action 与跟进到期时间 |
| executed 失败 failed | 不变 | `last_attempt_failed` + 失败摘要 | 重试 = 新请求 + 新批准；系统不自动重试 |
| bypass_blocked（绕过尝试被门拦截） | 不变 | — | 双侧审计留痕（§5.1）；T4/T5 专项核查对象 |

要点：**主状态只被 executed 成功推进**。pending / approved / rejected / expired / cancelled 都只是标记变化——这是「门管授权、工作台管生命周期」的直接推论，也是评审时核对实现的第一道题。

### 4.4 T4 专项测试必须覆盖的门禁路径清单

| # | 用例 | 期望 |
|---|---|---|
| G1 | 无 approved 记录时调 dispatch 执行投递 | 被门拒绝（default-deny），无任何发送发生，留痕 |
| G2 | 未注册 action_kind 发起请求 | 入队口拒绝 + `bypass_blocked` 审计（门侧与工作台侧各一笔） |
| G3 | agent 身份调用 requestApproval / execute | 结构性不可能或调用即拒 + `agent_boundary_violation` 事件 |
| G4 | 批准后更换 draft_ref 版本再执行 | 门校验载荷已变 → 拒绝执行，须重新批准 |
| G5 | approved 超过 24h 才执行 | 拒绝，提示重新批准 |
| G6 | pending 超过 72h | 门侧 expired；工作台标记清除且**不**自动重发、不自动执行 |
| G7 | rejected 之后查条目 | 主状态不变、不自动关闭、标记与 note 可见 |
| G8 | 同一条目重复点「投递」 | 幂等键去重，返回既有 pending/approved 记录，不生成第二份投递 |
| G9 | 跟进邮件/感谢信（D3）发起 | 同样入队过门，无「跟进不算投递」的旁路 |
| G10 | 静态 import 图检查 | 除 dispatch 外，队列/agent/CLI 模块均未引用 gate 的 request/execute 面 |
| G11 | 双侧对账 | 任取一条 executed 记录：`approval_audit` 与 `workbench_events` 以 approval_id 可互相查得 |
| G12 | preview（dry-run）反复调用 | 不改队列状态、不改条目标记、不产生审计外的副作用 |

## 五、全程留痕

### 5.1 记什么（事件目录，T2 落地）

`workbench_events` 只记四类事件：

1. **状态迁移**：`enqueued` / `transitioned`（from → to）/ `closed_abnormal` / `transition_rejected` / `enqueue_duplicate_blocked` / `overdue_marked`；
2. **agent 动作**：`task_created` / `task_done` / `task_failed` / `agent_degraded` / `agent_boundary_violation`；
3. **门交互**（工作台侧镜像，与门审计对账）：`approval_requested` / `approval_expired` / `dispatch_executed` / `dispatch_failed` / `bypass_blocked`；
4. **用户手动操作**：入队确认、迁移确认、标记清除、备注修改（actor 记 `cli:workbench <subcommand>` 或 `user`）。

每条事件字段：`id`（AUTOINCREMENT）/ `item_id` / `event` / `actor`（`user` / `cli:<command>` / `agent:<kind>` / `system`）/ `detail_json`（只存引用与摘要：approval_id、draft_ref、from/to、失败摘要、flag kinds）/ `occurred_at`（ISO 8601）。

### 5.2 存哪、存多久

- 同库：`~/.brain27/brain27.db` 新表 `workbench_events`，与 materials / approval_queue / approval_audit 并列；库文件 0600、目录 0700（复用 sqlite-store 既有权限模式）；`CREATE TABLE IF NOT EXISTS` 零迁移。
- append-only 纪律：store 层只暴露 append 与查询，不提供 UPDATE/DELETE（与 approval_audit 同纪律；是否加 trigger 防改写由 T2 按 PRD-175 实现先例决定）。
- 脱敏（承 PRD-175 §4.3 与 PRD-080 日志红线）：不存简历/PS/套磁信正文、不存邮件正文片段；detail_json 只放引用与摘要。
- 云端零写入：事件永不离开本机（PRD-080 数据边界延续）。

### 5.3 与 PRD-080 体系的衔接

同一数据库文件、同一 `~/.brain27/` 目录约定、同一 defaultPaths 风格；工作台呈现（list/show）从 `workbench_items` + `workbench_events` 读时间线，与 approvals show 的审计呈现风格保持一致，用户在一个 CLI 里看全：机会（pull/match）→ 材料（materials）→ 队列（workbench）→ 批准（approvals）。

## 六、与后续任务的衔接约定

### 6.1 T2 队列实现（#1161）

- 表结构与状态机以 §二为准（`workbench_items` / `workbench_events`，五值枚举、合法迁移全集、异常迁移守卫），不得增删枚举与 close_reason 取值域（扩展走评审）。
- CLI 命令族建议：`brain27 workbench add / list / show / move / close`（最终命名见 §七待决策 4）；既有命令零改动；迁移操作必须经「当前状态校验 + 事件追加」同一路径，不提供直改 state 字段的内部后门。
- 验收锚点（对应 PRD T2 标准「四状态间流转且全程留痕」）：每条合法迁移有正例测试，每条 §2.2 守卫有反例测试，迁移后 `workbench_events` 可完整还原时间线。

### 6.2 T3 多 agent 接入（#1162）

- agent 注册表（kind / 入口 / 权限集）落代码常量，权限集与 §3.4 表逐项对应；新增 agent 类型或扩权必须过评审并更新注册表，不允许运行时动态注册。
- 任务对象字段以 §3.2 为准；「产出落盘才算完成」「agent 不得互相派活」为 T3 验收硬项。
- agent 运行身份在事件 actor 中可辨（`agent:collector` 等），越权调用的拦截点（结构隔离或运行时校验）由 T3 选型，但 G3 用例必须能过。

### 6.3 T4 门禁衔接与测试（#1163）

- dispatch 出口按 §4.2 落地：单点 import、两段式、preview 免费、回执回写。
- §4.4 的 G1–G12 为**最低**覆盖集（对应 PRD T4 标准「无批准投递不可执行，测试覆盖门禁路径」），缺一即不达标；测试栈沿用仓库现行 `node --test`。
- D1–D6 六个触发点逐个有「过门正例 + 无批准反例」成对用例。

### 6.4 T5 验收口径（#1164）

- **完整求职周期演练**（对应 PRD T5 标准）：用全虚构样例走通一条拒绝线（入队 → 准备材料 → 投递过门 → 跟进 → 面试准备 → 被拒 → 复盘 → closed(review_done)）与一条成功线（… → closed(hired)），全程事件时间线完整可还原。
- **门禁零绕过**：G1–G12 全过 + 至少一次人工红队尝试（试图用 agent 身份/直调 execute/改稿偷换等路径绕过）被拦截并留痕，记录附验收报告。
- **留痕完整率**：演练中每一次状态迁移、每一次门交互在事件表中都有对应记录（抽查对账 §5.1/G11 方法）。

### 6.5 借鉴与样例纪律（T2–T5 共同）

- **借鉴纪律**：openbot 协议未核实——T2–T5 实现中不得出现 openbot 的代码、片段或其衍生表述；形态借鉴止于本文。若实现期间发现需要引用任何外部项目文字，先核实许可证并单独评审。
- **样例纪律**：文档、fixture、测试数据全虚构——机会 `opp-example-001`、邮箱 `hr@example.edu`、表单 `https://jobs.example.edu/apply/123`、回执 `<receipt@example.invalid>`；不得出现真实主机名、IP、账号或密钥。

## 七、待用户决策事项

随 T1 评审一并拍板（每项给默认建议）：

1. **终态形态**：四主状态之外单设终态 `closed`（带 close_reason），还是把「已录用」做成第五个主状态？
   背景：PRD 只定了四状态，但流程总得有结束点；录用与放弃、复盘完在队列呈现上都是「已结束」，差异只在原因。
   默认建议：**单设 `closed` + close_reason**（本文 §2.1 已按此写）——状态机保持小，呈现层按 reason 分组即可；若日后「录用后入职准备」成为新流程，再独立立项，不塞进本状态机。
2. **跟进提醒节奏**：`following` 条目的 next_action_due_at 默认值（如投递后 +7 天）。
   背景：只提醒、不自动发信是红线内的事，但默认节奏影响使用体验；太密烦人，太疏错过窗口。
   默认建议：**投递后 +7 天首次提醒，之后每 +7 天**，条目可单独改；提醒只在用户运行 status/list 时呈现，不做后台推送。
3. **agent 提议投递的发起方式**：准备 agent 备好投递包后，「发起批准请求」这一步由谁点？
   背景：§3.4 已定 agent 无权调用 requestApproval；剩下的选择是（a）用户在工作台确认后由 dispatch 发起（两道人工动作都在），还是（b）agent 生成「待发起」提议、用户点确认即发起。
   默认建议：**(a) 用户确认后由 dispatch 发起**——提议与发起分离，发起动作本身也是一个明确的人工确认点；(b) 与 (a) 的差别只是少一次点击，安全语义上 (a) 更干净。
4. **CLI 命令族命名**：`workbench` / `board` / `queue` 三选一。
   背景：与 PRD 名与既有命令风格（pull/match/draft/interview/status/approvals）的一致性。
   默认建议：**`workbench`**——与 PRD-232 名称一致、语义自明；`queue` 容易与 approval_queue 混淆，不推荐。

---

**下一步**：T1 评审通过（含 §七四项拍板）后进 **T2（#1161）：任务队列实现**——`workbench_items` / `workbench_events` 两表、状态机与守卫、workbench 命令族，测试覆盖 §6.1 验收锚点。
