# PRD-017/T4：Wiki 自维护 agent（trend #69）

> trend #69 要求：定期 agent 做去重合并、过期机会标记（已过截止日）、矛盾检测；
> 过期条目保留可追溯，默认检索过滤（T1 纪律）。

## 新增文件

| 文件 | 说明 |
|------|------|
| `lib/wiki/maintenance.ts` | 自维护：dedupeEntries / markExpired / detectConflicts / runMaintenance（纯函数） |
| `tests/wiki-maintenance.test.mjs` | 9 个测试，`node --test` 运行 |

## 语义

- **去重键**（T1 纪律"机构+项目+截止日"）：WikiEntry 层近似为
  `title + source + type + region`，有 `deadlineOf` 访问器时再加截止日，口径更严。
  同 key 的 active 条目只留一条（last_verified 最新者，并列取 confidence 高者），
  其余 status → `"merged"`（去重指针，保留可追溯，不进检索）。
- **过期标记**：fixed 截止日 < 今天 且 active → `"expired"`；rolling / 未知不动；
  无 deadlineOf 时无法判断，原样返回（诚实不猜）。
- **矛盾检测**（只报告不自动改）：同一机会出现多种不同截止日 → `deadline_mismatch`，
  需人工核对。注意：同标题不同截止日**不合并**（key 不同），走矛盾检测而非去重。
- **执行顺序**：去重 → 过期 → 矛盾检测；报告含 merges/expiredIds/conflicts/changed。

## 截止日来源

WikiEntry 本体无 deadline 字段，`deadlineOf?: (e) => ISO | "rolling" | null`
由调用方注入（MCP 扩展 McpOpportunity 有 deadline；T5 的 D1 适配产出也带 deadline）。

## 测试

`node --test tests/wiki-maintenance.test.mjs`：9/9 通过（本地验证；仓库完整 suite 需 clone+npm install，未跑）。

## 不确定 / 下一步

- 调度（cron/定时触发 runMaintenance）不在本 PR 范围。
- T5（trend #70）：D1 适配产出的条目带 deadline，可直接喂给本模块。
