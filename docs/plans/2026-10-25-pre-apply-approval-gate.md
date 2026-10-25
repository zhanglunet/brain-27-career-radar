# PRD-175/T1：批准队列 schema + 不可逆动作清单

> trend issue #875。对应 PRD-175（中央仓库 zhanglunet/trend）。
> 地位：T1 规范稿——不可逆动作清单与批准队列 schema 评审通过后，T2（投递/发送前拦截进队列，#876）、T3（本地确认入口 CLI/简单 UI，#877）、T4（与 PRD-080 申请助手流程对接，#878）、T5（验收，#879）均以本文为准；实现不得擅自增删动作枚举与字段。
> 借鉴声明：[Anil-matcha/open-duet](https://github.com/Anil-matcha/open-duet) 许可证实测为 Apache-2.0（法律上允许复用），但按 PRD-175 非目标纪律：**绝不复用其代码**，只借鉴「行动前批准（approve-before-act）」的产品形态思路。本文所有枚举、字段、状态机均为自研设计；若未来需要引用其文字表述，按 Apache-2.0 义务保留版权与许可声明并单独评审。本 PR 为纯加法 .md，无代码。

PRD-080 本地申请助手（`lib/local-apply/`）的现行纪律是「产物不代发」：CLI 无任何 send / submit / upload 命令，README 写明"点下提交的永远是你本人"。这条原则不动。PRD-175 做的是把「人工点确认」从一个**原则**升级为一套带审计的**机制**：当未来出现投递/邮件通道（T2 起拦截）、以及现有定稿导出等半不可逆动作时，先进批准队列，人确认才执行，全过程留痕。本设计只定「哪些动作算不可逆、队列长什么样、状态怎么流转」，不写实现。

## 一、现状锚点与设计落点

### 1.1 今天站在哪（main 实测）

| 模块 | 现状 | 与批准门的关系 |
|---|---|---|
| `lib/local-apply/cli.ts` | 命令面 pull / match / draft / interview / status；`guardText` 输出"禁止生成草稿、申请或提交" | 无发送命令；T2 起新增的投递/邮件通道是第一批被拦截对象 |
| `lib/local-apply/sqlite-store.ts` | materials 表（id/kind/opportunity_id/version/created_at/marker/content），落 `~/.brain27/brain27.db`，库 0600 / 目录 0700 | 队列与审计**同库新表**，复用打开与权限模式，不动 materials |
| `lib/local-apply/posting-guard.ts` | 机会正文外部文本检测，五类 flag，只检测不阻断、由用户裁决 | 入队请求携带 guard 结论；T3 确认界面醒目展示 |
| `lib/local-apply/docx/` + `scripts/docx-apply-demo.mjs` | PRD-150 已落地的本地 .docx 生成与"草稿三件套一键生成求职信演示" | `docx export --final`（去 AI 标注可投递版）登记为 A3；T4 把演示延长为"草稿→批准→投递包" |
| 云端 `db/schema.ts` 的 `review_queue` | 云端人工审核队列（status pending/observing/approved/rejected、review_mode、payload_json、resolution 三件套） | **形状先例**：本地批准队列与其同构（§3.3），云端零改动 |

### 1.2 落在哪

- 数据落点：`~/.brain27/brain27.db` 新增两张表 `approval_queue` + `approval_audit`（同 materials 一库，`CREATE TABLE IF NOT EXISTS` 零迁移）；
- 代码落点：T2 新增 `lib/local-apply/approval/`（registry.ts 清单 / gate.ts 执行口 / store.ts 队列读写），作为仓库内**唯一**的不可逆动作出口；
- 数据边界：一切只在本地 SQLite；云端 D1 零改动零写入（PRD-080「本地永不写云」延续）。

## 二、不可逆动作清单（Action Registry）

### 2.1 注册表（T1 评审对象）

| # | action_kind | 触发点（现状/未来） | 载荷要点 | 为何不可逆 | 风险级 |
|---|---|---|---|---|---|
| A1 | `email_send` | 未来通道（main 上不存在发送命令） | draft_ref、收件人、主题、正文引用 | 邮件发出即到达对方，无法撤回 | high |
| A2 | `webform_submit` | 未来通道 | draft_ref、目标 url、表单字段清单 | 第三方系统入库，留下投递痕迹，不可代为删除 | high |
| A3 | `file_export_final` | 已存在：PRD-150 `docx export --final`（生成去 AI 标注的可投递版） | draft_ref、输出文件名 | 导出物可能被直接拖进第三方网站；去标注后不再带 AI 声明 | medium |
| A4 | `profile_share` | 已存在边界：PRD-080 §二 #8「用户可手动导出分享」 | 导出对象与字段范围 | 个人数据一旦离开本机不可收回 | high |

处置：A1/A2 是 PRD 范围内「投递/邮件动作拦截」的 T2 收口对象；A3/A4 在 T1 登记留痕，是否纳入 T2 强制拦截见 §六待决策（推荐：T2 只收口 A1/A2，A3/A4 先全走人工批准）。

### 2.2 注册规则（回应"绕过队列的旁路 API"风险）

1. **default-deny**：执行层只认注册表内的 action_kind；未注册动作一律拒绝，并写 `bypass_blocked` 审计事件（§4.2）。
2. **单一执行口**：T2 起，一切不可逆动作必须经 `lib/local-apply/approval/gate.ts` 的执行口发出；cli/docx 等既有模块不得新增任何发送/提交调用。代码评审以"是否存在绕过执行口的发送路径"为红线项。
3. **dry-run 与幂等**：每个注册动作必须定义 dry_run（预演输出但不执行）与幂等键（§3.2）；无 dry_run 的动作不得注册。
4. **载荷最小化**：队列只存动作元数据与 `draft_ref` 引用，不复制材料正文（正文唯一权威副本在 materials，防双写漂移）。

## 三、批准队列 schema（approval_queue）

### 3.1 表字段（字段级）

| 字段 | 类型 | 约束 | 说明 | 虚构样例 |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | `{action_kind}:{opportunity_id}:{seq}`，seq 为同 (kind, opportunity) 自增 | `email_send:opp-example-001:1` |
| `action_kind` | TEXT | NOT NULL | 必须在 §2.1 注册表内 | `email_send` |
| `opportunity_id` | TEXT | NOT NULL | 关联机会（与 materials.opportunity_id 同语义；不设硬外键，缓存 id 与草稿 id 可能异源） | `opp-example-001` |
| `draft_ref` | TEXT | 可空；A1/A2 必填 | 引用 materials.id，不复制正文 | `cover_letter:opp-example-001:v2` |
| `payload_json` | TEXT | NOT NULL DEFAULT '{}' | 动作载荷（收件人、目标 url、附件名等元数据） | `{"to":"hr@example.com","subject":"应聘科研助理（示例）"}` |
| `idempotency_key` | TEXT | NOT NULL UNIQUE | 输入串（action_kind + opportunity_id + draft_ref + 收件人/URL）的 SHA-256 十六进制（64 位，样例从略）；防同一动作重复入队与重放 | — |
| `status` | TEXT | NOT NULL DEFAULT 'pending' | 枚举见 §4.1 | `pending` |
| `requested_at` | TEXT | NOT NULL，ISO 8601 | 入队时间 | `2026-10-25T09:00:00Z`（示例） |
| `requested_by` | TEXT | NOT NULL DEFAULT 'cli' | 触发来源：`cli:<command>` 或 `ui` | `cli:docx-apply-demo` |
| `guard_flags` | TEXT | NOT NULL DEFAULT '[]' | 上游 posting-guard 结论（flag kinds 数组）；A1/A2 请求生成时强制携带 | `["instruction_like"]` |
| `expires_at` | TEXT | pending 时写入 | pending 过期时点（默认 +72h，过期自动 expired，防"陈年请求"复活） | `2026-10-28T09:00:00Z`（示例） |
| `decided_at` | TEXT | 可空 | 人工决定时间 | `2026-10-25T10:00:00Z`（示例） |
| `decided_via` | TEXT | 可空，enum `cli`/`ui` | 决定渠道（T3 落地） | `cli` |
| `decision_note` | TEXT | 可空 | 人工备注（为何批准/拒绝） | `"核对过官方页（示例）"` |
| `approval_valid_until` | TEXT | approved 时写入 | 批准有效期（默认 +24h；执行前校验，过期须重新批准，防"批准后隔月执行"） | `2026-10-26T10:00:00Z`（示例） |
| `executed_at` | TEXT | 可空 | 执行完成时间 | `2026-10-25T10:05:00Z`（示例） |
| `execution_ref` | TEXT | 可空 | 执行回执引用（SMTP message-id、表单回执号等外部系统 id 形态；样例一律虚构） | `<receipt@example.invalid>` |
| `schema_version` | INTEGER | NOT NULL DEFAULT 1 | 表结构版本，后续迁移用 | `1` |

索引：`(status, requested_at)`、`(opportunity_id, action_kind)`；`idempotency_key` UNIQUE。

### 3.2 幂等与防重放

- 同一 `idempotency_key` 重复入队 → 直接返回既有 pending/approved 记录，不建新行；
- 执行前执行口重算幂等键与 `approval_valid_until`，**载荷有变即拒绝**（防"批准 A、偷换执行 B"）；
- executed/failed 为终态，重试 = 新请求新批准，不复活旧记录。

### 3.3 与云端 review_queue 的同构与差异

| 项 | 云端 review_queue（db/schema.ts，先例） | 本地 approval_queue（本设计） |
|---|---|---|
| 状态哲学 | pending → approved / rejected + 观察态 | pending → approved / rejected + 过期/撤回/执行终态 |
| 载荷 | payload_json | payload_json + draft_ref 引用（不复制正文） |
| 决定三件套 | resolution_code / resolution_note / resolved_by | decision_note / decided_via / decided_at |
| 审的对象 | 发布内容的风险 | 对外动作的授权 |
| 存储 | 云端 D1 | 本地 SQLite（云端不知道本地存在） |
| 执行环节 | 无 | 有（executed/failed + execution_ref 回执） |

## 四、状态机与审计记录（approval_audit）

### 4.1 状态机

```
pending ──批准──▶ approved ──执行成功──▶ executed（终态）
   │  │              └──执行失败──▶ failed（终态，重试须新请求）
   │  └──拒绝──▶ rejected（终态）
   ├──72h 未决定──▶ expired（终态，system 自动）
   └──用户撤回──▶ cancelled（终态）
```

七态：pending / approved / rejected / executed / failed / expired / cancelled。终态一律不可再改，只能新开记录。

### 4.2 审计表字段（append-only）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | 追加式流水 |
| `approval_id` | TEXT | NOT NULL | 对应队列记录 id |
| `event` | TEXT | NOT NULL | enum：requested / approved / rejected / cancelled / executed / failed / expired / **bypass_blocked** |
| `actor` | TEXT | NOT NULL | `cli:<command>` / `ui` / `system`（expired 由 system 写） |
| `detail_json` | TEXT | NOT NULL DEFAULT '{}' | 事件细节（备注、失败原因摘要、bypass 尝试的调用入口） |
| `occurred_at` | TEXT | NOT NULL，ISO 8601 | 事件时间 |

追加纪律：store 层只暴露 appendAudit()，不提供任何 UPDATE/DELETE 语句；可选加固为 SQLite trigger 拒绝改写（T2 决定）；T5 验收含"审计不可改写"用例与"bypass 尝试被记录"用例。

### 4.3 脱敏纪律（呼应 PRD-080 §二 #10 日志红线）

- 队列与审计**不存**简历/PS/套磁信正文（正文只在 materials）；
- `detail_json` 只存引用与摘要（draft_ref、flag kinds、失败原因），不存正文片段；
- `execution_ref` 只存外部系统返回的 id 形态，不存信件内容；
- 审计字段名出现在日志即按 PRD-080 脱敏规则处理（T5 专项审计）。

## 五、与 PRD-080 / PRD-150 的对接点

| # | 对接点 | 现有模块（main 实测） | PRD-175 动作 |
|---|---|---|---|
| 5.1 | 同库不同表 | `sqlite-store.ts`（materials，`~/.brain27/brain27.db`，0600/0700） | approval_queue + approval_audit 同库新表；复用打开/权限模式；materials 为只读引用方 |
| 5.2 | CLI 命令面 | `cli.ts`（pull/match/draft/interview/status；无发送命令） | T3 新增 `brain27 approvals list\|approve\|reject <id>`；现有命令零改动——拦截语义是"T2 起新增发送/投递通道必须经执行口"，属预防性收口 |
| 5.3 | 定稿导出 | PRD-150/T2 `docx export --final` | A3 入队留痕；是否自动批准 §六拍板 |
| 5.4 | 申请助手一键流程 | `scripts/docx-apply-demo.mjs`（PRD-150/T4 草稿三件套演示） | T4（#878）延长演示为「草稿三件套 → 入队 → 人工批准 → 投递包生成」，批准步骤真人点确认 |
| 5.5 | 外部文本门禁 | `posting-guard.ts` 五类 flag + `cli.ts` guardText（只呈现、由用户裁决） | 入队请求强制携带 guard 结论（guard_flags）；带 flag 的 A1/A2 不允许自动批准，T3 确认界面醒目展示命中项 |
| 5.6 | 数据边界 | PRD-080 §二 数据边界表（本地 → 云端方向永远为空） | 队列与审计只落本地；云端零改动；网络发送只存在于"批准后执行"路径，且仅执行口可发起 |

## 六、禁复用声明、样例纪律与下一步

**禁复用（T5 验收硬项）**：open-duet 许可证实测为 Apache-2.0；即便法律允许，PRD-175 非目标仍明确**不复用其代码**——本设计与 open-duet 实现零代码血缘，只保留「行动前批准」产品思路层面的一致性。T5（#879）验收含"无 open-duet 代码/片段入库"专项检查；如未来需引用其文字，按 Apache-2.0 保留版权与许可声明并单独评审。

**样例纪律**：本文与后续实现的样例全虚构——机会 `opp-example-001`（"某大学脑科学中心科研助理（示例）"）、邮箱 `hr@example.com`、表单地址 `https://jobs.example.com/apply/123`、回执 `<receipt@example.invalid>`；文档、fixture、测试数据中不得出现真实主机名、IP、账号或密钥（PRD 风险条款；T5 含"无真实隐私样例入库"专项）。

**下一步**：确认后进 **T2（#876）：投递/发送前拦截进队列**——`lib/local-apply/approval/`（registry / gate / store）、default-deny 与 bypass_blocked 审计、拦截测试（仓库现行 node --test 栈）。

随 T1 确认一并拍板的三个小决策：

1. 双有效期默认值：pending 72h / approved 24h（本设计推荐值，可调）；
2. A3 `file_export_final` 是否默认自动批准（推荐：否，先全走人工，观察后放宽）；
3. A4 `profile_share` 是否纳入 T2 强制拦截（推荐：T1 登记留痕，T2 只收口 A1/A2，与 PRD「投递/邮件动作拦截」范围一致）。
