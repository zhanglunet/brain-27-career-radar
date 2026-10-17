# PRD-017/T1 草稿：brain-27 机会情报 Wiki —— 知识源盘点 + 条目 schema v0.1

> 对应 trend issue #66。下一步：T1 确认后进 T2（RAG 检索层）。

## 一、知识源盘点

| 编号 | 来源 | 形态 | 量级 | 入库方式 |
|------|------|------|------|----------|
| S1 | D1 快照与候选记录 | 结构化（快照/日志/候选/证据/审核结论） | 116 源持续增长 | 只引用不复制：条目挂 D1 证据链接 |
| S2 | 每日情报日报结论 | 半结构化（日报文本） | 每天 1 份 | 自动起草 → 人工确认入库 |
| S3 | 学术顶会日历节点 | 结构化（13 个重点会议的投稿/会议日期） | 13 会议 | 变更时自动起草更新条目 |

**不入库**：D1 原始 HTML 快照全文（太大，链过去就行）；未审核的候选记录（等审核结论）。

## 二、条目 schema v0.1

```yaml
title: 条目标题（机会/主题一句话）
source: 来源名称（如 "UCL 官网博士招生页"）
source_url: 来源链接
source_type: d1_snapshot | daily_report | conference_calendar | manual
d1_evidence: D1 证据链接（S1 必填，其他可选）
confidence: high | medium | low   # 审核结论映射：已审核=high，待核验=medium，传闻=low
created: 2026-10-17               # ISO 日期
last_verified: 2026-10-17         # 最后核验日期
status: active | expired | merged  # active=有效，expired=已过截止日，merged=被合并去重
tags: [phd, 脑机接口, 英国, 全奖]    # 类型/方向/地区/资助
body: 正文，不超过 300 字
```

**纪律**：
- `confidence=low` 的条目默认检索降权，不进入 Top 结果。
- `status=expired` 保留可追溯，默认检索过滤。
- 同一机会（机构+项目+截止日）只留一条，后到的走"更新"不新建（`merged` 记录合并链）。

## 三、示例条目（2 条，按真实数据形态编写）

### 示例 1：博士机会

```yaml
title: UCL 认知神经科学博士（2027 秋季入学）
source: UCL 官网博士招生页
source_url: https://www.ucl.ac.uk/（示例）
source_type: d1_snapshot
d1_evidence: d1://snapshots/ucl-phd-20261017
confidence: high
created: 2026-10-17
last_verified: 2026-10-17
status: active
tags: [phd, 认知神经科学, 英国, 全奖]
body: UCL 2027 秋季认知神经科学博士招生，CSC 联合资助通道开放中。申请截止 2027-01-08，需提前联系导师。国际学生注意学费差额：CSC 覆盖部分以官网为准，差额自理风险已标注。
```

### 示例 2：顶会节点

```yaml
title: OHBM 2027 摘要投稿截止
source: OHBM 官网
source_url: https://www.humanbrainmapping.org/（示例）
source_type: conference_calendar
d1_evidence: ~
confidence: medium
created: 2026-10-17
last_verified: 2026-10-10
status: active
tags: [conference, 脑成像, 摘要投稿]
body: OHBM 2027 年会摘要投稿截止日为 2027-01-15（预计，以官网为准）。脑科学方向最重要的年会之一，摘要型录用可参会张贴。建议提前 2 周准备初稿。
```

## 四、T2 衔接

T2 检索层直接消费本 schema：`tags` 做过滤面，`confidence` 做排序权重，
`status` 做默认过滤，`body` + `title` 做向量化文本，`d1_evidence` 做证据链。
