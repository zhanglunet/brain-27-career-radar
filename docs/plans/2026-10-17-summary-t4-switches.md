# PRD-019/T4：摘要开关与阈值（trend #84）

> T1 设计：trend #78 / brain-27 PR #18《docs/plans/2026-10-17-summary-format.md》§四：
> `summary.enabled`（总开关，默认 true）、`summary.top_n`（默认 10）、
> `summary.upcoming_days`（默认 30）；`?full=1` 单次回全量，兼容老调用方。

## 变更文件

| 文件 | 说明 |
|------|------|
| `lib/mcp/summary-config.ts` | 新增：`SummaryConfig` 类型、`DEFAULT_SUMMARY_CONFIG`、`resolveSummaryConfig()`（合并+校验） |
| `lib/mcp/summary.ts` | 修改：`ListOpportunitiesOptions` 新增 `config?: Partial<SummaryConfig>`；`listOpportunities` 先解析配置 |
| `tests/summary-config.test.mjs` | 新增：8 个测试 |

## 行为

- `config.enabled=false` → 回全量列表（`mode: "full"`）。
- `full=true`（`?full=1`）→ 始终回全量，不受开关影响。
- 默认（不传 config）→ 摘要模式，与 T2 行为一致（现有 10 个 T2 测试全过，向后兼容）。
- 非法值（topN 越界/非整数、upcomingDays 越界、enabled 非布尔）抛错。

## 测试

`node --test tests/summary-config.test.mjs`：8/8 通过；`tests/summary.test.mjs`（T2 既有）：10/10 通过。
仓库完整 suite（`npm test`/`tsc`/`eslint`）未跑：PAT 不支持 git HTTPS，本机无 clone。

## 不确定 / 下一步

- 配置目前是函数参数级（调用方传入）；如需全局配置文件/环境变量，走 T4 后的运维需求另议。
- 下一步：T5 回归脚本（trend #86）。
