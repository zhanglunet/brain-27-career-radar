# PRD-017/T3：日报 → Wiki 自动沉淀流水线（trend #68）

> T1 设计：trend #66 / brain-27 PR #16《docs/plans/2026-10-17-wiki-schema.md》§一 S2。
> trend #68 要求：每日情报日报自动起草 wiki 条目；草稿必须人工确认才入库，不自动发布。

## 新增文件

| 文件 | 说明 |
|------|------|
| `lib/wiki/ingest.ts` | 流水线：起草 → 校验门 → 人工确认 → 入库（纯函数） |
| `tests/wiki-ingest.test.mjs` | 8 个测试，`node --test` 运行 |

## 流程

```
intelligence_reports 行（D1 只读）
  → draftFromReport：highlights.opportunities / papers 逐条起草
      （sources 为来源名录不起草；confidence 强制 medium=待核验）
  → partitionValid：入库前重跑 validateEntry，有问题的草稿不得入库
  → decideDraft：人工确认（approved/rejected），确认人 = 配置 owner
  → ingestApproved：已确认 + 校验通过 → WikiEntry[]
  → overdueDrafts：超 24h 未确认标 overdue（isDraftOverdue）
```

## 关键决策

- **不自动发布**：`WIKI_PIPELINE_CONFIG.dailyReport.requireHumanConfirm=true` 落实在
  `decideDraft`——没有人工 approved，`ingestApproved` 永远返回空数组。
- **校验门重跑**：人工确认环节可能编辑草稿，入库前重跑 `validateEntry`，
  不信任起草时的 issues 快照。
- **起草质量诚实**：日报 highlights 只有名字，facets.type/region/funding、
  source_url 等起草时无法可靠提取 → 记入 `needsFields` 交人工补，不编造。
- **SLA**：dailyReport.slaHours=24，超期草稿标 overdue（供调度提醒，不自动丢弃）。

## 测试

`node --test tests/wiki-ingest.test.mjs`：8/8 通过（本地验证；仓库完整 suite 需 clone+npm install，未跑）。

## 不确定 / 下一步

- 真实接线（读 intelligence_reports → 调本模块 → 写 wiki 存储）待 wiki 存储落定后做；
  本 PR 只交付纯函数流水线。
- T4（trend #69）：自维护 agent 可复用 `validateEntry` 门。
