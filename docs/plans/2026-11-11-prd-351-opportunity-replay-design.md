# PRD-351/T1：机会评估重放包设计（当时为什么推这个，可复现）

> trend issue #1630。对应 PRD-351（2026-10-30 日报遗留第 7 条，用户「继续」按既定流水线立项）。
> 设计日：2026-11-11 · 目标仓库：zhanglunet/brain-27-career-radar
> 状态：T1 设计草案，待评审。仅设计文档（纯加法 .md）；重放账本内核（T2）、重放闸门（T3）、划界断言（T4）、全链验收（T5）按本设计后续落地。
> 示例全部虚构占位（`机会 O-001` 占位风格），不出现真实主机名、IP、账号、密钥。

## 0. 红线

| # | 红线 | 落地方式 |
|---|---|---|
| R1 | **重放包三件套齐备** | `{input_fingerprint（机会快照 digest+评分规则版本）, decisions（评分理由与权重）, output（推荐结论与复核状态）}` 缺一拒绝入账（T3） |
| R2 | **投递零自动** | 重放只复算评估层——投递动作仍走 PRD-175 批准门，门不变；重放零投递触发（T4 AST：零投递导入，与 PRD-337/T4 同表） |
| R3 | **对不上即报账本失败** | 重放结论与包内不一致 → REPLAY_MISMATCH 显形落失败证据，零静默换新推荐 |
| R4 | **账本 append-only** | ReplayLedger 只增不删 |
| R5 | 占位符纪律（来源 URL 一律 example.invalid） | T5 检查覆盖本文件 |
| R6 | 实现类 PR 只开不合并 | 等用户 review |

## 1. 借鉴对象、许可证与不复用红线

beenuar/AiSOC（MIT，2026-11-11 实测）+ CopilotKit/OpenBot（MIT，实测）——只借鉴「可重放决策账本」形态；包 schema 按本仓机会评估域自研，零代码复用，不引入原仓依赖。

## 2. 与既有机制划界

| 维度 | PRD-351（本条） | PRD-281 档案草稿回滚 | PRD-176 真实性复核 | PRD-175 批准门 |
|---|---|---|---|---|
| 管什么 | 评估**可重算** | 改动可逆 | 独立复核 | 投递拦截 |
| 重放 | 评估层复算 | 版本回滚 | 独立再验 | 无 |
| 投递语义 | 零投递触发（R2） | 零 | 零 | 门放行 |

## 3. 重放包设计

### 3.1 schema（T2 预埋）

```json
{"schema": "opportunity-replay-pack/v1",
 "input_fingerprint": {"opportunity_id": "O-001（占位）", "snapshot_digest": "sha16:…",
   "scoring_rules_version": "vN"},
 "decisions": [{"score": 0, "weights": {"…": 0.0}, "why": "评分理由（占位）"}],
 "output": {"recommendation": "recommend|hold（占位）", "review_state": "pending|confirmed"}}
```

### 3.2 流程（确定性）

指纹复核（机会快照 digest 不符 → REPLAY_INPUT_DRIFT 拒绝）→ 注入同规则版本重放评分（纯函数）→ 结论逐字节比对 → REPLAY_OK / REPLAY_MISMATCH。

## 4. 失败闸门（T3 落地）

| 错误码 | 触发 | 行为 |
|---|---|---|
| REPLAY_INPUT_DRIFT | 机会快照指纹不符 | 拒绝重放 |
| REPLAY_MISMATCH | 结论不一致 | 显形+失败证据入账 |
| PACK_INCOMPLETE | 三件套缺一 | 拒绝入账 |

## 5. 衔接

T2 内核；T3 闸门（三码+R2 零投递 AST）；T4 划界（与 281/176/175 划界钉值）；T5 样例回放+MISMATCH 演练+文档无密钥。

## 6. 开放问题

1. 评分规则版本的固化口径（规则文本 hash vs 版本号——倾向两者都入指纹，待 T2）；
2. 与 PRD-337 聚合报告的衔接（聚合 entries 可否作机会快照来源——倾向可，digest 同源，待 T2）。
