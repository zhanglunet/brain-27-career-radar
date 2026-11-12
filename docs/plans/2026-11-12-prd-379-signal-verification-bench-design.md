# PRD-379/T1：机会信号验证台设计（信号来源复核过才进机会库）

> trend issue #1883。来源：2026-11-12 GitHub 趋势日报（digests/2026-11-12.md）第 7 条，用户 2026-11-13 指令「拍板」采纳。
> 设计日：2026-11-12 · 目标仓库：zhanglunet/brain-27-career-radar
> 状态：T1 设计草案，待评审。仅设计文档（纯加法 .md）；验证台内核（T2）、闸门（T3）、划界断言（T4）、验收试运行（T5）按本设计后续落地。
> 示例全部虚构占位，不出现真实内部主机名、IP、账号或密钥。

## 0. PR 门槛自查（repos.yaml default_pr_gate）

| 门槛 | 落实 |
|---|---|
| require_integration_point | **接入点：`lib/public_info_aggregate.py::aggregate` 产出公开信息信号之后、机会库入库与 `lib/approval_inbox.py::collect(delivery_pending=…)`（PRD-365 收件箱）之前**——T2 验证台以注入式函数 `verify_signal(signal, corpus, recheck_fn)` 供聚合流程在入库前调用；只有 VERIFIED 的信号进机会库 |
| no_missing_channel | 只消费 aggregate 既有信号结构与来源语料（corpus 注入）；复算=对同一语料快照重跑同一来源复核判定（recheck_fn 注入，复核=来源 URL 在语料中可复访+quote 逐字回指）；验证结论写本地 JSONL 账本（文件落库），零新外部渠道 |
| no_duplicate_module | main 上同类模块盘点：public_info_aggregate.py（信号聚合产出）/ opportunity_replay.py（351 重放——管"评估可重算"，本条管"信号可复访"，粒度不同）/ job_doc_snapshot.py（281 档案快照）/ approval_inbox.py（365 收件箱）。**本条不另起来源复核**：复算=重跑注入的同一复核判定，比对信号的后端来源与 quote 回指一致才 VERIFIED |
| impl_requires_devlog | T2~T5 实现 PR 各附 docs/devlog/2026-11-13-prd-379-*.md 开发记录+合规核对；账本落 JSONL 文件（路径注入），不只存内存 |

## 1. 红线

| # | 红线 | 落地方式 |
|---|---|---|
| R1 | **信号来源复核过才进机会库** | 每条机会信号先按来源复核（溯源三件套齐全、来源 URL 在语料快照中可复访 + quote 逐字回指）；复核不过 → UNVERIFIED——假信号拦在机会库外，投递批准门只审验证过的机会（不进 365 收件箱） |
| R2 | **验证不产生新信号** | 复算=重跑注入的同一来源复核判定（语料快照只读深拷贝，零真实网络复访——复访=对既有语料快照复算）；复现不出=UNVERIFIED 不猜不补 |
| R3 | **机器可读落账** | 每次验证 `{signal_id, source_url, kind, source_ref, corpus_fingerprint, signal, reproduce, verdict}` 八件套落 JSONL 账本；缺任一 BENCH_INCOMPLETE 拒绝入账 |
| R4 | **账本 append-only + 修复二次验证才关闭** | 验证账本只增不删；语料变更后二次验证落新记录，关闭以最新 VERIFIED 为准 |
| R5 | 占位符纪律（来源 URL 一律 example.invalid） | T5 检查覆盖本文件 |
| R6 | 实现 PR 只开不合并 | 等用户 review |

## 2. 借鉴对象、许可证与不复用红线

openai/codex-security（Apache-2.0，实测）+ cloudflare/security-audit-skill（MIT，实测）——只借鉴「发现→验证→修复→再验证」控制面形态；条目 schema 按本仓机会域自研，零代码复用，不引入原仓依赖。

## 3. 与既有机制划界

| 维度 | PRD-379（本条） | PRD-337 聚合 | PRD-295 @引用 | PRD-351 重放包 | PRD-365 收件箱 |
|---|---|---|---|---|---|
| 管什么 | 逐条 **信号可复访** | 信号产出 | 指令寻址 | 评估可重算 | 等人批准 |
| 比对 | 信号 vs 重跑来源复核 | 无 | 无 | 包内输出 vs 重演 | 无 |
| 关系 | aggregate 之后、入库之前 | 被消费 | 被区分 | 被区分 | 下游：验证过才可进 |

- 反爬拒绝显形、零伪装红线不变（复访=对语料快照复算，零真实外呼零绕过）。

## 4. 验证台设计

### 4.1 条目 schema（T2 预埋）

```json
{"schema": "signal-verify-bench/v1",
 "items": [{"signal_id": "s-001",
   "source_url": "https://o001.example.invalid/1（占位）",
   "kind": "job_opening",
   "source_ref": "public-info-aggregate/v1#signals[0]（占位）",
   "corpus_fingerprint": "sha16:…（语料快照）",
   "signal": {"title": "岗位（占位）", "quote": "招聘（占位）"},
   "reproduce": {"source_match": true, "quote_match": true, "detail": "…（占位）"},
   "verdict": "VERIFIED|UNVERIFIED"}]}
```

### 4.2 流程（确定性）

aggregate 信号 → 逐条重跑同一来源复核判定（注入 recheck_fn，语料快照深拷贝）→ 来源在语料中可复访（source_match）+ quote 逐字回指（quote_match）双 match → VERIFIED / 否则 UNVERIFIED → 落账 → 机会库只收 VERIFIED。

## 5. 失败闸门（T3 落地）

| 错误码 | 触发 | 行为 |
|---|---|---|
| BENCH_INCOMPLETE | 八件套缺一/词表外 | 拒绝入账 |
| BENCH_REPRO_MISMATCH | 声称 VERIFIED 但 source/quote 复现不含（或反之） | 显形拒绝 |
| BENCH_STALE | 语料快照指纹与当前不符 | 拒绝复用旧验证 |

## 6. 衔接

T2 内核（verify_signal + JSONL 账本）；T3 闸门（三码+零网络零投递词面 AST）；T4 划界（与 351 重放/365 收件箱/337 聚合划界钉值+来源复核零 import 注入重跑）；T5 样例全链回放+UNVERIFIED 拦截演练+文档无密钥（URL 一律 example.invalid）。

## 7. 开放问题（留待评审/T2）

1. 溯源三件套口径（倾向 signal 带来源 URL+quote+时间戳三件套齐才入账——待 T2）；
2. 机会库侧接入的强制方式（倾向 verify_signals 包装供 aggregate 调用方显式接入——待 T2）。
