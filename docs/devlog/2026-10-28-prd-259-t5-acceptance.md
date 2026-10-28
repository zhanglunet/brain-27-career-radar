# PRD-259/T5 验收试运行记录：模拟限流与切换

- 日期：2026-10-28
- trend issue：[zhanglunet/trend#1299](https://github.com/zhanglunet/trend/issues/1299)
- 中央 PRD：`trend/adopted/PRD-259-brain27-agent-reach-opportunity-layer.md`
- 仓库：brain-27-career-radar，分支 `trend/prd-259-t5-acceptance`（自 `trend/prd-259-t4-boundary-doc` 切出）
- 验收标准（issue 原文）：**不绕登录墙；无密钥**
- 本 PRD 红线：限定公开来源，遵守 ToS/限流；不绕登录墙

## 1. 验收对象（T1–T4 全链）

| 环节 | trend issue | 交付 | 自测 |
|---|---|---|---|
| T1 设计 | #1295（issue #76 对应 PR） | `docs/plans/2026-10-28-prd-259-opportunity-source-layer.md` | — |
| T2 机会源能力层最小实现 | PR #78（trend #1296） | `lib/opportunity-sources.mjs`（opportunity-source-v1 校验拒载/健康四态/doctor） | 7 例 |
| T3 主备切换与审计事件 | PR #80（trend #1297） | failover/restore/source_failover+source_restore/exportEvents | 7 例 |
| T4 边界文档 | PR #82（trend #1298） | `docs/plans/2026-10-28-prd-259-boundary-117-203.md`（5 例文档断言） | 5 例 |

T5 为纯验收：只新增 `tests/test_prd259_acceptance.test.mjs`（8 例）与本记录，不改 T2–T4 行为。

## 2. 验收项 ↔ 测试映射（1:1）

| # | 验收项 | 测试 |
|---|---|---|
| 1 | 模拟主源故障→failed→切换：连续 5 次失败 → failed → `source_failover` 事件字段齐全（source_id/from/to/reason/at），standbyInUse 更新，健康判定与失败计数不被切换动作扰动，exportEvents 可序列化 | `验收1 主源故障→failed→切换` |
| 2 | 429 throttled 分列：限流≠故障（不进 failed、不触发切换、不产事件），doctor summary.throttled 独立计数 | `验收2 429 throttled 分列` |
| 3 | 恢复切回留痕：`source_restore` 事件（备源→主源），事件序列 [failover, restore] 有序，导出为深拷贝，restore 后新一轮故障可再切换 | `验收3 恢复切回留痕` |
| 4 | 违规条目拒载：auth≠none（cookie/bearer）/缺 tos_url/data_class≠public 逐条 SourceRejected；混入坏条目的注册表整表拒载 | `验收4 违规条目拒载` |
| 5 | doctor JSON 四态一一对应：healthy/degraded/failed/throttled 四源四态，per_source 与 summary 全等，ToS 列在位 | `验收5 doctor JSON 四态` |
| 6 | 不绕登录墙：结构断言（auth 只收 "none"，cookie/bearer/basic/session 全拒）+ 交付模块登录墙绕过字面量（cookie/csrf/session id/authorization/bearer/x-api-key/password/sign-in/localStorage/puppeteer/playwright/stealth/user-agent）扫描零命中 | `验收6 不绕登录墙` |
| 7 | 零网络：fetch 封死跑完故障/限流/切换/恢复/doctor 全场景零触发；交付模块零网络库导入（模块零 import） | `验收7 零网络` |
| 8 | 交付面无密钥：PRD-259 全部交付面（源码 1 + 测试 4 + 设计稿 2 + 本记录）密钥样式与内网 IP 样式扫描零命中 | `验收8 交付面无密钥` |

## 3. 试运行结果（真实输出）

验收测试逐项（`node --test tests/test_prd259_acceptance.test.mjs`，分支
`trend/prd-259-t5-acceptance`，工作区 commit `712e4ce` 之上）：

```
✔ 验收1 模拟主源故障→failed→切换：source_failover 事件字段齐全
✔ 验收2 429 throttled 分列：不进 failed、不触发切换、doctor 独立计数
✔ 验收3 恢复切回留痕：source_restore 事件 + 序列有序 + restore 后可再切换
✔ 验收4 违规条目拒载：auth≠none / 缺 tos / data_class≠public 逐条拒绝+整表拒载
✔ 验收5 doctor JSON 四态一一对应：per_source 与 summary 全等
✔ 验收6 不绕登录墙：auth 只收 none（结构断言）+ 代码路径字面量零命中
✔ 验收7 零网络：fetch 封死跑完全场景零触发 + 无网络库导入
✔ 验收8 交付面无密钥：PRD-259 全部交付面密钥/内网 IP 样式零命中
# tests 8 # pass 8 # fail 0
```

试运行过程记录（如实）：首轮 3 处报红，均为验收测试自身问题并当场修正——
`assert.equal(calls, [])` 在 node:assert/strict 下按引用比较恒假（改 `.length`）；
四态夹具的 failed 源未配备源导致 failover 无从切换（补 mirror 夹具）；内网端点
自检字面量命中检查式自身（改正则形态，不留明文端点字面量）。另首轮 #8 因本记录
尚未落盘报 ENOENT（扫描面含本记录），落盘后复跑 8/8 全绿。

## 4. 全量回归（含 T1–T4 零回归）

环境性说明（如实区分）：裸 `node --test tests/*.test.mjs`（Node v22.17.1）下
42 个既有测试文件因 `lib/**/*.ts` 导入报 `ERR_UNKNOWN_FILE_EXTENSION`——Node
类型剥离未开启所致，与本 PRD 无关、为基线既有；以
`NODE_OPTIONS=--experimental-strip-types node --test tests/*.test.mjs` 口径
（同一命令先测基线、后测含验收全量）：

```
基线（剔除本验收文件）:  # tests 390  # pass 390  # fail 0
含验收全量:             # tests 398  # pass 398  # fail 0
```

390 → 398（+8 = 本验收例数），**T1–T4 全链零回归**（T2 7 例 + T3 7 例 +
T4 5 例全部通过，含在 390 内）。

## 5. 红线自查

- **限定公开来源，遵守 ToS/限流**：注册表硬校验 `data_class=public` + `tos_url`
  必填 + `rate_limit` 必填（验收 #4 拒载面）；429 归 throttled 分列、不硬冲、
  不触发切换（验收 #2）。
- **不绕登录墙**：auth 只收 `none`，需要登录态/令牌的来源在注册口即被拒（验收
  #4/#6 结构断言）；交付模块零登录墙绕过代码路径字面量（验收 #6 扫描）。
- **切换全留审计**：failover/restore 事件字段齐全、序列有序、导出可序列化
  （验收 #1/#3）。
- **零网络**：fetch 封死全场景零触发；模块零网络库导入（验收 #7）。
- **无密钥**：全部交付面密钥/内网 IP 样式扫描零命中，示例源全 example.com
  占位（验收 #8）。

## 6. 结论

验收标准「不绕登录墙；无密钥」达成：8/8 验收测试通过；模拟限流与切换全链路
（故障→failed→切换→恢复→切回）事件断言齐全；doctor 四态一一对应；违规条目
拒载；零网络；全交付面零密钥。全量回归 398/398（含本验收），T1–T4 零回归。
PR 只开不合并，等用户 review。
