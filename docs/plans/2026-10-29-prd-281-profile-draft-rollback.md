# PRD-281/T1：求职档案改动草稿 + 回滚设计（profile-draft-v1 + confirm 原子生效 + 上一版回滚）

- 日期：2026-10-29
- 来源：2026-10-28 趋势日报 brain-27-career-radar 第 1 条（⭐），用户当日拍板采纳
- trend issue：[zhanglunet/trend#1406](https://github.com/zhanglunet/trend/issues/1406)（中央 PRD 任务表所写 #1410 为旧编号，以本 issue 实测为准）
- 中央 PRD：`trend/adopted/PRD-281-brain27-profile-draft-rollback.md`
- 状态：T1 设计稿，待评审；实现类任务（T2–T4）只开 PR 不合并
- 本批主题：可逆改动包（14 仓同构：先快照、再改动、一键回上一版）

> ⚠️ 借鉴红线：[Gathin23/cleanyourtv](https://github.com/Gathin23/cleanyourtv) 经 GitHub License API 实测为 **NOASSERTION（无协议）**（中央 PRD 记录 2026-10-28 实测，本设计 2026-10-29 复核一致）。本设计**仅借鉴"先快照再改动、一键还原"的形态思路**，零代码、零 schema 定义、零文案复用；本仓草稿对象、confirm/rollback 语义、审计事件全部原创设计。无协议仓库的任何内容引入即有法律风险，明确禁止（详见 §7）。

## 1. 目标与非目标

**目标**：求职档案（`~/.brain27/profile.json`，本文以 `<档案路径>` 占位；字段面 = `lib/local-apply/docx/profile.ts` 的 JobDocProfile 六区块）的结构化改动**先进草稿**（diff 形态改动 + 目标对象指纹），`confirm(draft)` **原子生效**；生效时**上一版自动保留**，可一键 `rollback` 回上一版。全程本地、全程留痕。**投递动作仍走 PRD-175 批准门，门一个字节不变**（本条 import 图无投递执行依赖，T4 结构断言）。

**非目标**：
- 不做云端同步——档案只在本机 `~/.brain27/`，云端 D1 零改动零写入；
- 不自动投递——175 门领域不沾；档案 confirm/rollback 是可逆本地改动，**不进** `ACTION_REGISTRY`（其四项不得增删，见 §2）；
- 不做多版本历史——上一版单槽（覆盖式）；
- 不新增档案字段语义——草稿只搬运字段值，六区块字段表仍以 JobDocProfile 为准，老档案 `[待填写：字段路径]` 占位语义不变。

## 2. 与既有能力的划界

| 既有能力 | 关系 |
|---|---|
| PRD-175 投递前批准门 | **175 管不可逆动作**：`approval/registry.ts` 实测 `ACTION_REGISTRY` 四项（`email_send`/`webform_submit`/`file_export_final`/`profile_share`），T1 规范"不得增删"；**281 管可逆档案改动**：可 rollback 故不入注册表、不走批准队列。划界要点：**档案 confirm ≠ profile_share**——confirm 只落本机文件、零外发；A4 分享仍走 175 批准队列不变。281 代码 import 图无投递执行依赖（`approval/gate.ts` 执行口、`docx export --final`、邮件/表单通道零依赖，T4 断言，同 PRD-260 §3.4 手法） |
| PRD-232 本地求职工作台 | **232 管工作台形态**：任务队列四状态（待投递/跟进中/面试准备/已拒绝复盘）、多 agent 分工、门禁衔接（T1 尚未落地）；**281 管档案改动可逆**：对象级 undo。232 落地后的档案编辑类任务应**消费** 281 的草稿机制（消费关系，非互相实现）；281 不建队列、不定义 agent 角色、不做状态流转 |
| PRD-260 技能录制器 | 260 录"岗位要求了什么技能"（录制→草稿→入库门）；281 草稿的 `source` 枚举预留 `skill_recorder`（录制结论可作为草稿生成来源之一），T1 不接线——草稿仍需人工 confirm，**无自动生效路径** |
| `lib/local-apply/docx/profile.ts`（JobDocProfile 六区块） | 草稿 diff 的**字段面**：JSON Pointer 指向六区块路径（`/basics`、`/education`、`/experience`、`/skills`、`/outputs`、`/target`）；`profile.json`（`cli.ts:46` CliProfile）是其现役子集，草稿不改字段表 |
| 现状写入口 | main 实测：`profile.json` **只有读取方**（cli/matcher/drafter/interview/docx），无任何代码写入口——档案今天靠手改。281 起：结构化改动的程序化写入**只存在于 confirm 与 rollback 两个写点**（T2 起唯一写入口） |

## 3. 方案设计

### 3.1 改动草稿 `profile-draft-v1`（schema）

```json
{
  "schema": "profile-draft-v1",
  "draft_id": "pfd_<uuid>",
  "created_at": "<ISO8601>",
  "source": "manual_edit | skill_recorder | agent_suggestion",
  "target": {
    "object": "profile",
    "path": "<占位：~/.brain27/profile.json>",
    "sha256_before": "<目标对象改前整文件指纹>"
  },
  "changes": [
    { "op": "set | remove", "pointer": "/skills/2", "before": "<旧值或 null>", "after": "<新值或 null>" }
  ],
  "change_count": 1,
  "status": "draft"
}
```

要点：

1. **diff 形态**：逐字段 `op`（RFC 6901 JSON Pointer 指向六区块路径），**不存整文件副本**——档案唯一权威副本仍是 `profile.json` 本体，防双写漂移（与 175 T1 §2.2 #4"载荷最小化"同一纪律）；
2. **目标对象指纹**：`sha256_before` 是**整个目标文件**的指纹（不是逐字段）。confirm 前重验：手改与草稿并发（指纹漂移）→ confirm 拒绝（`confirm_conflict`），草稿需以新指纹重算 diff 后重新入草稿（rebase 语义），**不静默合并**；
3. **敏感数据纪律**：档案本身是敏感个人数据（basics 含姓名/邮箱/电话）——draft 文件 0600、目录 0700、不入仓库（`examples/doc-profile.sample.json` 虚构样例先例）；审计行不含字段值（§3.4）；
4. **机会标注扩展位**：`target.object` 预留 `"opportunity_annotation"`（中央 PRD 背景第二对象），其本地标注落点由 232 工作台落地时锚定，T1 只定对象形态、不实现。

### 3.2 存储落点（T2）

```
lib/local-apply/profile-drafts/
  draft.ts      # 草稿构建：现档案 + 改动意图 → profile-draft-v1（整文件指纹 + 逐字段 diff）
  confirm.ts    # 原子生效：指纹重验 → 上一版保留 → temp+rename 落盘（§3.3）
  rollback.ts   # 一键回上一版：单槽交换（§3.3）
  audit.ts      # brain27.db 审计表写入（§3.4）
tests/profile-drafts-*.test.ts   # node --test，可擦除 TS 语法（与 matcher.ts 同约定）
```

```
<占位：~/.brain27>/profile.drafts/<draft_id>.json   # 草稿（diff 形态），0600
<占位：~/.brain27>/profile.previous.json            # 上一版单槽（confirm 时自动覆盖写入），0600
```

沿既有纪律：`~/.brain27/` 目录 0700、库/文件 0600（`brain27.db` 同款，PRD-175 T1 实测）；一切本地，云端 D1 零改动零写入。

### 3.3 confirm 原子生效与 rollback 语义

```
confirm(draft_id):
  1. 重验 target.sha256_before 与当前 profile.json 指纹一致（不一致 → confirm_conflict，不合并）
  2. 上一版自动保留：当前 profile.json 原子复制 → profile.previous.json（覆盖上一槽）
  3. 原子落盘：新档案写临时文件 + rename（同目录原子替换），权限 0600 保持
  4. 审计：profile_draft_confirmed（before/after 指纹、change_count、source）
  5. 草稿状态置 confirmed 留档（不删除——审计可查）

rollback():
  1. profile.previous.json 存在性检查（无 → rollback_refused，如实记录）
  2. 交换语义：当前档案 ↔ previous 单槽互换（回滚前当前版自动成为新的"上一版"）
  3. 原子落盘 + 指纹校验 + 审计 profile_rolled_back
```

- **回滚可再回滚**：单槽交换使"回滚"本身精确可逆一次（再交换即回前状态），任意时刻只有一版"上一版"——满足"不做多版本历史"；
- **回滚一律人工触发**：档案没有"健康检查"类可量化的客观失败信号，**不设自动回滚触发器**、不引入自动决策（推荐/录制产出只能是草稿 `source`，永不自动 confirm）——这与 PRD-280 的"健康检查失败自动回滚"是两仓各自红线，不混同；
- **投递门**：confirm/rollback 全程不产生任何投递/外发动作；若上层流程（未来 232 工作台任务）走到投递步骤，输出"请走 PRD-175 批准门"提示而非任何执行动作（T5 端到端断言，同 260 手法）。

### 3.4 审计（brain27.db 新表 `profile_change_audit`）

同库新表（`CREATE TABLE IF NOT EXISTS` 零迁移，复用 `sqlite-store.ts` 打开与 0600 权限模式，不动 `materials`/`approval_queue`/`approval_audit`）：

| 字段 | 说明 | 虚构样例 |
|---|---|---|
| `at` | ISO8601 | `2026-10-29T09:00:00Z`（示例） |
| `event` | `draft_created / draft_confirmed / draft_discarded / rolled_back / confirm_conflict / rollback_refused` | `profile_draft_confirmed` |
| `draft_id` | `pfd_<uuid>` | `pfd_example-001` |
| `fingerprint_before` / `fingerprint_after` | 目标对象整文件 sha256（64 位十六进制） | `<占位>` |
| `change_count` | diff 条数 | `1` |
| `pointers` | JSON Pointer 清单（**只路径、无值**） | `["/skills/2"]` |
| `source` / `trigger` / `operator` | 来源 / 触发（manual）/ 操作者 | `manual_edit / manual / cli` |

红线：审计行**零档案字段值**——basics（姓名/邮箱/电话）等敏感值永不落审计，只落指针与指纹（与 175 审计"载荷最小化"同一纪律）。

## 4. 安全红线

1. **投递门一个字节不变**：本条不新增任何投递/发送/上传路径；`ACTION_REGISTRY` 四项不增删；本条 import 图无投递执行依赖（T4 结构断言）；
2. **confirm ≠ 外发**：档案改动只落本机；`profile_share`（A4）仍走 175 批准队列不变；
3. **回滚一律人工触发**：档案无可量化的客观失败信号，不引入自动回滚/自动决策；草稿生成来源（推荐/录制）永不自动 confirm；
4. **敏感数据本地化**：draft/previous/审计全在 `<占位：~/.brain27/>`（0700/0600），不入仓库、不进云端；审计零字段值；
5. **原子性**：confirm/rollback 单写点 temp+rename；指纹漂移即拒绝（`confirm_conflict`），不静默合并；
6. 示例全虚构：档案字段值（姓名/邮箱/学校/公司）、指纹、路径全占位；文档与测试无真实主机名/IP/账号/密钥。

## 5. T2–T5 任务拆分（按 PRD）

| 任务 | 内容 | 交付 |
|---|---|---|
| T2 | 快照存储与回滚最小实现：`profile-drafts/`（draft/confirm/rollback/audit）+ 上一版单槽 + `profile_change_audit` 审计表 | 样例可快照可回滚，审计可查，有测试 |
| T3 | 草稿确认流：`confirm(draft)` 原子生效（指纹重验 + temp+rename）+ 上一版自动保留 + 漂移拒绝 | 确认生效与保留有测试 |
| T4 | 175 门不变断言：本条 import 图无投递执行依赖（结构性测试，同 PRD-260 §3.4 手法）+ `ACTION_REGISTRY` 零改动断言 | 结构断言通过 |
| T5 | 验收试运行：样例全流程回放（草稿→confirm→上一版保留→rollback→再回滚）+ 回滚演练（无 previous/指纹冲突/敏感值权限）+ 文档无密钥 | 快照回滚全链通过；红线断言全过；文档无密钥 |

## 6. T5 验收标准

1. 虚构档案走完 草稿→confirm→rollback→再回滚：逐字段与整文件指纹回到预期状态，previous 单槽语义正确（任意时刻仅一版上一版）；
2. 指纹漂移：confirm 前手改 `profile.json` → `confirm_conflict`，不合并不覆盖，草稿 rebase 后可重新 confirm；
3. 无 previous 时 rollback → `rollback_refused` 且审计留痕；
4. 结构断言全过：`profile-drafts/**` import 图无 `approval/gate.ts` 执行口、无投递/邮件/表单/`docx export --final` 依赖；`ACTION_REGISTRY` 仍为四项；端到端流程到投递步骤输出 175 门提示；
5. 审计字段齐全（event/draft_id/前后指纹/pointers/change_count/at），审计行零档案字段值（含伪邮箱样例扫描 0 命中）；
6. 文档与测试无密钥、无真实主机名/IP/账号；样例档案全虚构。

## 7. 借鉴划界

- [Gathin23/cleanyourtv](https://github.com/Gathin23/cleanyourtv)：GitHub License API 实测 **NOASSERTION（无协议）**（中央 PRD 记录 2026-10-28 实测，本设计 2026-10-29 复核一致）。本设计只借鉴"**先快照、再改动、一键还原**"这一产品形态思路（通用工程常识，不构成独创表达），**未读取、未复用其任何代码、schema、文案、配置**。本仓草稿对象、confirm/rollback 语义、审计事件全部基于本仓既有资产（`profile.json`/CliProfile 读取面、JobDocProfile 六区块、`brain27.db` 存储与权限纪律、175 审计纪律）原创推导。因其无许可证，任何形式的代码或文案引入都有法律风险，明确禁止，未来也不会引入。
- 与 PRD-232 的划界落实：中央 PRD 背景称"区别于 PRD-232 本地求职工作台（工作台形态）：本条是档案改动可逆"——本设计落实为对象划界（232=队列状态机与多 agent 分工的流程形态，281=档案对象的改动可逆），232 落地后为 281 草稿机制的消费方；281 不建队列、不定义 agent 分工。
- 编号修正：中央 PRD 任务表所写 T1 issue #1410 为旧编号，实际 issue 为 [zhanglunet/trend#1406](https://github.com/zhanglunet/trend/issues/1406)（实测为准）。
