# PRD-017/T5：D1 适配器（trend #70）

> trend #70 要求：Wiki 条目与 D1 快照/候选记录双向链接——条目引用 D1 证据，
> D1 记录可跳转 wiki 解读；不动现有 D1 采集流水线。

## 新增文件

| 文件 | 说明 |
|------|------|
| `lib/wiki/d1-adapter.ts` | D1 行 → WikiEntry 纯映射（只读） |
| `tests/wiki-d1-adapter.test.mjs` | 7 个测试，`node --test` 运行 |

## 表结构依据（drizzle/migrations 原文，非推测）

| 表 | 迁移 | 用途 |
|----|------|------|
| `opportunities` | 0000 | 机会：name/org/kind/location/deadline/why/action/tags_json/url/published |
| `candidate_records` | 0003 | 候选：title/org/kind/location/deadline/canonical_url/snapshot_id/state |
| `source_snapshots` | 0000 | 快照：final_url/excerpt/captured_at |
| `review_queue` | 0000 | 审核：status/reason/payload_json |
| `sources` | 0000 | 来源名录：name/url |

## 映射约定（适配器 v0.1，文档化）

- **kind（中文）→ type**：博士→phd、联培博士/联合培养博士→joint_phd、科研助理/研究助理→ra、
  校招/校园招聘→campus、实习→intern；未知 kind 不硬编 → 留空。
- **location → region**：香港→中国香港、英国/伦敦→英国、爱尔兰/都柏林→爱尔兰、
  全球/remote→全球、 mainland 城市 hint（北京/上海/深圳…）→中国大陆；未知不硬编。
- **confidence**：`opportunityToEntry` 默认 pending（待核验），可传入 review_queue
  关联出的 verdict；`reviewRowToVerdict` 主信号为 `payload_json.verdict`，
  兜底 reason 关键词，默认 pending。
- **T1 纪律**：未审核的候选不入库 → `candidateToEntry` 无 verdict 参数时返回 null；
  未发布（published != 1）的机会返回 null。
- **双向链接**：条目 id 固定为 `wiki-d1-opp-{rowId}` / `wiki-d1-cand-{rowId}`，
  由 D1 行 id 可直接算出 wiki 条目 id；`d1_evidence` 指回 D1（有快照指快照，
  否则指行：`d1://opportunities/{id}` / `d1://snapshots/{id}` / `d1://candidates/{id}`）。
- **扩展字段**：返回 `D1WikiEntry = WikiEntry & { org, deadline, funding }`，
  org/deadline 直接取 D1 原文（deadline 可能是 "预计 2026.10—11 发布" 这类自由文本，
  不强行解析），供 MCP 层消费；不改已合并的 `lib/wiki/schema.ts`。

## D1 只读

本模块只做行 → 条目的纯映射，不写库、不动采集流水线。

## 测试

`node --test tests/wiki-d1-adapter.test.mjs`：7/7 通过（本地验证；仓库完整 suite 需 clone+npm install，未跑）。
测试行数据为按迁移表结构手写的合成行，非生产数据。

## 不确定 / 下一步

- `review_queue` 的真实 status/reason 取值未知，`reviewRowToVerdict` 的兜底规则是
  best-effort；主信号 `payload_json.verdict` 需 T5 落地时与实际数据对一遍。
- 真实接线（读 D1 → 适配 → 入 wiki 存储）待 wiki 存储落定后做。
