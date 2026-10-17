# PRD-019/T5：摘要模式回归验证（trend #86）

> trend #86：现有页面/API 行为回归——摘要不丢关键字段（截止日/资助类型）。

## 变更文件

| 文件 | 说明 |
|------|------|
| `tests/summary-regression.test.mjs` | 新增：5 个回归测试，`node --test` 运行 |

## 回归项

1. **计数对账**：`buildSummary(stats)` 与 `buildFullList(items)` 逐项复算的统计深比较，
   差 1 条即失败（T1 防误判 #2）。
2. **token 断言**：`measureJsonBytes(摘要) * 10 <= measureJsonBytes(全量)`（T1 review 意见，
   测量基础由 T2 的 `measureJsonBytes` + 并列 builder 提供）。
3. **关键字段不丢失**：Top N 条目 deadline/funding/org 缺一即须标 `incomplete`，
   不得静默丢失。
4. **防误判标注**：摘要顶部与统计段均带强制 note。
5. **默认行为回归**：`listOpportunities` 默认走摘要模式。

## 数据集

63 条确定性合成条目（T1 示例量级；类型/地区/资助/截止日均匀分布），非生产数据。
本地验证压缩比 24.1x（摘要 1872B / 全量 45172B），远超 10x 目标。

## 测试

`node --test tests/summary-regression.test.mjs`：5/5 通过。
仓库完整 suite（`npm test`/`tsc`/`eslint`）未跑：PAT 不支持 git HTTPS，本机无 clone。

## 诚实注记

token 1/10 目标针对生产量级数据；合成数据只能证明机制有效。
生产环境须用真实数据重跑本文件（T1 review 意见原话）。
