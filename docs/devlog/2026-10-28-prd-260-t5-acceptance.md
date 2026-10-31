# PRD-260/T5 验收试运行记录：虚构求职实操→技能；投递被批准门拦住直至确认

- 日期：2026-10-28
- trend issue：[zhanglunet/trend#1304](https://github.com/zhanglunet/trend/issues/1304)
- 中央 PRD：`trend/adopted/PRD-260-brain27-skill-recorder-job-skills.md`
- 仓库：brain-27-career-radar，分支 `trend/prd-260-t5-acceptance`（自 `trend/prd-260-t4-gate-assertions` 切出）
- 验收标准（issue 原文）：**无 PII/密钥；批准门有效**
- 本 PRD 红线：投递动作仍走 PRD-175 批准门；个人信息必须清掉，本地处理

## 1. 验收对象（T1–T4 全链）

| 环节 | trend issue | 交付 | 自测 |
|---|---|---|---|
| T1 设计 | #1300（issue #77 对应 PR） | `docs/plans/2026-10-28-prd-260-job-skills-recorder.md` | — |
| T2 求职实操录制管线 | PR #79（trend #1301） | `lib/job-capture.mjs`（job-capture-v1 白名单封闭/值类禁录侧门封死/J-1~J-4 脱敏） | 8 例 |
| T3 清单技能草稿生成 | PR #81（trend #1302） | `lib/job-skill-draft.mjs`（draftFromCapture/175 门固定项 required 强制插入/removeGateLine 闸门） | 7 例 |
| T4 投递路径断言 | PR #83（trend #1303） | `lib/apply-path-assertions.mjs`（assertNoApplyPath 六形态/assertGateLinePresent） | 6 例 |

T5 为纯验收：只新增 `tests/test_prd260_acceptance.test.mjs`（9 例）与本记录，不改 T2–T4 行为。

## 2. 验收项 ↔ 测试映射（1:1）

| # | 验收项 | 测试 |
|---|---|---|
| 1 | 虚构求职实操回放 → job-capture-v1 时间线：白名单封闭（顶层 6 键/step 6 键）、pi_involved 只记布尔、投递语义步入线 | `验收1` |
| 2 | PII 样例阻断不落盘：J-1 邮箱/手机/证件 + J-2 简历句式 + J-3 token URL + 值类禁录字段（form_value）全部 CaptureBlocked，时间线逐字节零污染 | `验收2` |
| 3 | 草稿为清单形态：required:true 的 175 门固定清单行在场 + review 块（draft/reviewer 空）+ source:recorded，assertGateLinePresent 确认在位 | `验收3` |
| 4 | 删 175 门的草稿被闸门拒绝：removeGateLine 对含行/缺行/空/非字符串恒 false；缺行正文过 assertGateLinePresent 抛 GateLineMissing | `验收4` |
| 5 | 投递语义步骤触发「走门」提示而非执行：技能运行器走到提交步只输出 175 门提示（含 required:true、等待人工确认），投递函数零调用 | `验收5` |
| 6 | assertNoApplyPath：干净模块过（绊线在岗）；submitApplication/autoApply/auto_apply/直投方法/直投端点 URL/POST apply 六形态脏模块全抛 ApplyPathDetected | `验收6` |
| 7 | import 图无投递执行依赖 + 零网络：三模块导入面封闭（capture 零导入；draft→capture；assertions→draft）、零网络库字面量；fetch 封死跑完 录制→草稿→运行器→断言 全场景零触发 | `验收7` |
| 8 | 全产物与交付面零 PII 零密钥：录制导出/草稿渲染/走门提示零泄漏；全部交付面（lib 3 + tests 4 + 设计稿 + 本记录）密钥/PII/内网 IP 样式扫描零命中（docs/lib 严格零命中；链内 T2 测试 PII 夹具申报豁免） | `验收8` |
| 9 | 确定性：同输入两次完整流程（录制→导出→草稿→渲染）逐字节一致；captured_at 由调用方给定 | `验收9` |

## 3. 试运行结果（真实输出）

验收测试逐项（`node --test tests/test_prd260_acceptance.test.mjs`，分支
`trend/prd-260-t5-acceptance`，工作区 commit `1adf1ff` 之上）：

```
✔ 验收1 虚构求职实操回放→job-capture-v1 时间线：白名单封闭、最小字段
✔ 验收2 PII 样例阻断不落盘：J-1/J-2/J-3/值类禁录全拦，capture 零污染
✔ 验收3 草稿为清单形态：required 175 门固定行在场 + review 块
✔ 验收4 删 175 门的草稿被闸门拒绝：removeGateLine 恒 false
✔ 验收5 投递语义步骤触发「走门」提示而非执行：投递函数零调用
✔ 验收6 assertNoApplyPath：干净模块过；六形态脏模块全抛
✔ 验收7 import 图无投递执行依赖 + 零网络：导入面封闭、fetch 封死零触发
✔ 验收8 全产物与交付面零 PII 零密钥：扫描零命中
✔ 验收9 确定性：同输入两次完整流程逐字节一致
# tests 9 # pass 9 # fail 0
```

试运行过程记录（如实）：首轮 4 处报红，均为验收测试自身问题并当场修正——
技能运行器的走门判定条件与清单行形态不匹配（回放补投递语义步）；POST apply
脏样本与 T4 实际静态形态不符（对齐 T4 用例形态）；另 #8 因本记录尚未落盘报
ENOENT（扫描面含本记录），落盘后复跑 9/9 全绿。验收用 PII 样本全部运行时
拼造（邮箱 join 拼接/号段拼接），本文件与全部源文件零 PII 字面量；链内 T2
测试自带的 PII 夹具（example 邮箱/测试手机号，其断言恰好证明样本被 J-1/值类
禁录零存活）在测试面申报豁免，docs/ 与 lib/ 严格零命中。

## 4. 全量回归（含 T1–T4 零回归）

口径与 PRD-259/T5 一致（同一命令先测基线、后测含验收全量；裸 `node --test`
下 42 个既有测试文件因 `.ts` 导入报 `ERR_UNKNOWN_FILE_EXTENSION` 为 Node
类型剥离未开启的环境性既有问题，与本 PRD 无关，如实区分）：

```
NODE_OPTIONS=--experimental-strip-types node --test tests/*.test.mjs
基线（剔除本验收文件）:  # tests 391  # pass 391  # fail 0
含验收全量:             # tests 400  # pass 400  # fail 0
```

391 → 400（+9 = 本验收例数），**T1–T4 全链零回归**（T2 8 例 + T3 7 例 +
T4 6 例全部通过，含在 391 内）。

## 5. 红线自查

- **投递动作仍走 PRD-175 批准门**：草稿固定清单项 required:true 不可删
  （removeGateLine 恒 false + assertGateLinePresent 双闸，验收 #3/#4）；技能
  运行到投递语义步只输出走门提示、等待人工确认、投递函数零调用（验收 #5）；
  import 图无投递执行依赖、assertNoApplyPath 六形态绊线在岗（验收 #6/#7）。
- **个人信息必须清掉，本地处理**：录制模型 PII 无字段可装（值类禁录侧门封死），
  J-1/J-2/J-3 阻断式脱敏样本全拦且时间线零污染（验收 #2）；全产物与交付面
  PII/密钥/内网 IP 扫描零命中（验收 #8）。
- **本地处理/零网络**：fetch 封死全场景零触发，模块零网络库导入（验收 #7）。

## 6. 结论

验收标准「无 PII/密钥；批准门有效」达成：9/9 验收测试通过；虚构求职实操
回放→job-capture-v1 时间线→清单技能草稿全链路走通；投递被批准门拦住直至
人工确认（走门提示而非执行）；全产物零 PII 零密钥；确定性复现。全量回归
400/400（含本验收），T1–T4 零回归。PR 只开不合并，等用户 review。
