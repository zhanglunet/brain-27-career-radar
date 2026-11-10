# PRD-365/T1：投递批准门收件箱设计（门拦下的变成人桌面上的）

> trend issue #1644。对应 PRD-365（2026-11-11 日报第 8 条，用户「继续」按既定流水线立项）。
> 设计日：2026-11-11 · 目标仓库：zhanglunet/brain-27-career-radar
> 状态：T1 设计草案，待评审。仅设计文档（纯加法 .md）；收件箱内核（T2）、批阅闸门（T3）、划界断言（T4）、全链验收（T5）按本设计后续落地。
> 示例全部虚构占位，不出现真实主机名、IP、账号、密钥。

## 0. 红线

| # | 红线 | 落地方式 |
|---|---|---|
| R1 | **收件箱零自动执行** | approve/reject 只改条目状态留痕——approved **零投递触发**：投递动作仍走 PRD-175 批准门由人执行；INBOX_AUTO_EXEC_ATTEMPT 拒绝投递载荷（T4 AST 与 337/T4 同表） |
| R2 | **只读汇聚** | 统一收口三类待答项：PRD-175 门拦下的待批投递、PRD-295 @引用解析歧义候选（REF_AMBIGUOUS 人工选）、档案改动草稿确认（PRD-281）——门继续各拦各的 |
| R3 | **每项带证据** | 逐条 `{item_id, kind, source_ref, fingerprint, reason, candidates?（歧义候选）, state}` 缺一拒绝入箱——fingerprint 与 PRD-351 重放包同源 |
| R4 | **账本 append-only + 拒绝留痕** | reject 留 by/at/reason |
| R5 | 占位符纪律 | T5 检查覆盖本文件 |
| R6 | 实现类 PR 只开不合并 | 等用户 review |

## 1. 借鉴对象、许可证与不复用红线

backnotprop/plannotator（Apache-2.0，实测）+ pingdotgg/t3code（MIT，实测）——只借鉴「人工拍板收件箱」控制面形态；条目 schema 按本仓求职域自研，零代码复用，不引入原仓依赖。

## 2. 与既有机制划界

| 维度 | PRD-365（本条） | PRD-175 批准门 | PRD-295 引用解析 | PRD-337 聚合 |
|---|---|---|---|---|
| 管什么 | 待答项**统一视图** | 投递拦截 | 列候选 | 信息采集 |
| 操作语义 | 人批/拒（零自动） | 门放行 | 二值返回 | 只读采集 |
| 投递语义 | 零投递触发（R1） | 门内人工 | 零 | 零 |

## 3. 收件箱设计

### 3.1 schema（T2 预埋）

```json
{"schema": "approval-inbox/v1",
 "items": [{"item_id": "item-001",
   "kind": "delivery_approval|ref_disambiguation|profile_draft_confirm",
   "source_ref": "approval-gate/v1#pending[0]（占位）",
   "fingerprint": "sha16:…", "candidates": ["O-001（占位）", "O-002（占位）"],
   "reason": "歧义候选需人工选（占位）",
   "state": "pending|approved|rejected", "decided_by": null, "decided_at": null}]}
```

### 3.2 状态机（确定性）

collect（三源只读汇聚）→ pending；人 approve/reject 留痕（歧义项 approve 必须携带选中候选——不带则显形拒绝）；重复裁决/未知 id 显形拒绝。

## 4. 失败闸门（T3 落地）

| 错误码 | 触发 | 行为 |
|---|---|---|
| INBOX_ITEM_INCOMPLETE | 证据缺一 | 拒绝入箱 |
| INBOX_DOUBLE_DECIDE | 重复裁决 | 显形拒绝 |
| INBOX_AUTO_EXEC_ATTEMPT | 条目携带投递载荷 | 拒绝（R1） |
| INBOX_CHOICE_REQUIRED | 歧义项 approve 未带候选 | 显形拒绝 |

- kind 词表封闭三项。

## 5. 衔接

T2 内核；T3 闸门（四码+R1 零投递 AST）；T4 划界（fingerprint 与 351 同源+与 175/295/281 划界钉值）；T5 样例回放+文档无密钥。

## 6. 开放问题

1. 歧义候选的选择形态（approve 携带 candidate_id vs 单独 pick 动作——倾向 approve 携带，少一个动作词，待 T2 裁决）；
2. 档案草稿确认的粒度（整草稿 vs 逐字段——倾向整草稿+批注留痕，待 T2）。
