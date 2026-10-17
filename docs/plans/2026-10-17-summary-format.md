# PRD-019/T1 草稿：brain-27 机会列表"摘要模式" —— 格式设计 v0.1

> 对应 trend issue #78。下一步：T1 确认后进 T2（列表 API 摘要模式）。

## 一、设计目标

一次列表调用 token 量降到全量的 1/10 以内；摘要里的分类计数与全量一致；
关键字段（截止日/资助类型/机构名）零缺失。

## 二、三段式摘要格式

### 第一段：统计段

```json
{
  "total": 63,
  "by_type":    { "phd": 21, "joint_phd": 6, "ra": 9, "campus": 15, "intern": 8, "research": 4 },
  "by_region":  { "英国": 24, "中国大陆": 18, "中国香港": 11, "爱尔兰": 10 },
  "by_funding": { "full": 19, "partial": 12, "mixed": 7, "self": 9, "tbd": 16 },
  "note": "完整数据在详情页，可下钻"
}
```

### 第二段：截止临近 Top N（默认 N=10）

```json
{
  "upcoming": [
    { "id": "opp_001", "title": "UCL 认知神经科学博士", "org": "UCL",
      "deadline": "2027-01-08", "days_left": 83, "funding": "full" },
    { "id": "opp_002", "title": "港中文脑成像科研助理", "org": "CUHK",
      "deadline": "2026-11-30", "days_left": 44, "funding": "partial" }
  ],
  "top_n": 10,
  "more_available": true
}
```

排序：`fixed` 按 `days_left` 升序；`rolling` 降权并在条目上标注 `(滚动申请，无硬截止)`；
`tbd` 不进 Top N。

### 第三段：下钻入口

```json
{
  "drill_down": "GET /opportunities/:id 返回完整详情（含 D1 证据链接、历次核验记录）",
  "full_list": "GET /opportunities?full=1 返回全量列表（兼容老调用方）"
}
```

## 三、防误判机制（硬性）

1. 摘要顶部强制标注：`"完整数据在详情页，可下钻"` —— agent 不得把摘要当全量引用。
2. 分类计数必须与全量查询一致：T5 回归用脚本逐项对账，差 1 条即失败。
3. 关键字段零缺失：Top N 条目的 `deadline/funding/org` 任一缺失，该条目降级为
   `"incomplete": true` 并排到 Top N 末尾，不静默丢弃。

## 四、开关与阈值（T4 预告）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `summary.enabled` | true | 总开关；false 则恢复全量默认 |
| `summary.top_n` | 10 | Top N 数量 |
| `summary.upcoming_days` | 30 | "临近"天数 |
| `?full=1` | — | 单次请求回全量，兼容老调用方 |

## 五、文本示例（agent 视角）

> 共 63 个机会：博士 21、科研助理 9、校招 15……未来 30 天截止 7 个，
> 最近的是港中文脑成像科研助理（11-30 截止，部分奖学金）。
> 完整数据在详情页，可下钻。

## 六、T2 衔接

T2 在列表接口实现本格式：默认摘要，`?full=1` 回全量；T3 实现
`GET /opportunities/:id` 详情接口；T5 回归脚本对账计数与关键字段。
