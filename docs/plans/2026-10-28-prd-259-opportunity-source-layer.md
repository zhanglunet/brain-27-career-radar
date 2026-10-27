# PRD-259/T1：Agent-Reach 式机会源能力层 + doctor 设计

- 日期：2026-10-28
- 来源：2026-10-27 趋势日报 brain-27-career-radar 第 1 条（⭐），用户当日拍板采纳
- trend issue：[zhanglunet/trend#1295](https://github.com/zhanglunet/trend/issues/1295)
- 中央 PRD：`trend/adopted/PRD-259-brain27-agent-reach-opportunity-layer.md`
- 状态：T1 设计稿，待评审；实现类任务（T2–T4）只开 PR 不合并

## 1. 目标与非目标

**目标**：公开机会源（招聘 RSS、公司职位公开页、公开 API）之上建**来源健康与切换层**：每来源声明 ToS 与限流、配置主备；主源故障/被限流时切换有审计；`doctor` 一眼看出哪个源健康、哪个被限流、哪个故障。

**非目标**：
- 不做机会的搜索与分析——聚合归 PRD-117，内容浏览归 PRD-203；本条是**接入与健康层**；
- 不绕登录墙、不取私有数据、不用个人账号态抓取；限定公开来源；
- 不自动投递/不触碰任何申请动作（PRD-175 批准门领域，本条不沾）。

## 2. 与既有能力的划界

| 既有能力 | 关系 |
|---|---|
| PRD-117 聚合搜索层 | 117 管搜索聚合（怎么找机会），259 管来源健康与切换（来源挂了怎么办）；117 的来源可注册到 259 |
| PRD-203 自动浏览 | 203 管浏览内容；259 不管内容，只管可达性与健康 |
| PRD-175 投递批准门 | 完全无关——259 只读公开源，零投递路径 |
| 既有 source-monitor / paper-providers | 既有 provider 抓取模块可逐步注册进 259 的来源表获得健康管理；迁移是 T4 之后的演进项，不在本 PRD 强制 |

## 3. 方案设计

### 3.1 机会源注册表（`opportunity-source-v1`）

```json
{
  "schema": "opportunity-source-v1",
  "source_id": "jobs-rss-example",
  "kind": "rss|public-page|public-api",
  "primary": { "url": "https://jobs.example.com/rss", "tos_url": "https://jobs.example.com/tos", "rate_limit": { "requests_per_min": 6, "burst": 3, "note": "<上游明示或保守自设>" } },
  "standbys": [ { "url": "https://mirror.example.com/jobs-rss", "tos_url": "...", "rate_limit": {} } ],
  "auth": "none",
  "data_class": "public",
  "enabled": true,
  "notes": "<收录范围一句话>"
}
```

加载器硬校验：`auth` 只允许 `none`（需要登录态/token 的来源不收录）；`data_class` 只允许 `public`；`tos_url` 必填。

### 3.2 健康模型与主备切换（T3）

- 状态机：`healthy → degraded（连续≥2 失败）→ failed（连续≥5 或明确 403/404）`；`429` 标记 `throttled`（限流≠故障）；
- failed 自动切第一个可用备源，写审计事件 `source_failover`（source_id/from/to/reason/at），恢复后探测切回同样留痕；
- 全部请求按来源限流配置排队；429 退避不硬冲、不轮换身份；
- 拉取到的机会数据带 `source_id` 与 `fetched_at`——下游可追溯"这条机会来自哪个源"。

### 3.3 doctor（T2）

人读表格 + `--json`：

```
source_id       primary_state  standby_in_use  throttled  last_ok    tos
jobs-rss-ex     healthy        -               -          5min ago   https://jobs.example.com/tos
page-ex         throttled      -               429×3      1h ago     https://example.com/tos
api-ex          failed         mirror(1)       -          3h ago     https://api.example.com/tos
```

JSON 形态含 per_source 状态、限流用量（used/limit）、last_error_class、tos_url；被限流与故障分列（处理动作不同：等待 vs 切换）。

### 3.4 与 PRD-117/203 的边界说明（T4）

- 117 聚合搜索：向 259 请求"给我一个可用的 jobs 源"，259 返回 `(source_handle, health_meta)`；117 不自建连接；
- 203 自动浏览：浏览动作仍走 203 自身机制，但目标 URL 健康性可查 259（`is_healthy(url)`）；
- 边界一句话：**259 管"源活着吗、挂了怎么办"，117/203 管"拿它做什么"**。

## 4. 安全红线

1. 只接公开来源：auth=none + data_class=public 是加载器校验项，违规拒载；不绕登录墙、不用个人账号态；
2. ToS 与限流声明必填；429 退避不硬冲；
3. 切换全留审计；doctor 与审计输出零密钥零内网主机名；
4. 拉取的机会数据只含公开信息（工作名/公司公开名/链接），不含任何个人投递数据；
5. 示例源全用 example.com 占位。

## 5. T2–T5 任务拆分（按 PRD）

| 任务 | 内容 | 验收标准（PRD 原文口径） |
|---|---|---|
| T2 | 来源注册与 doctor 最小实现 | 健康/限流/故障态可显示 |
| T3 | 主备切换与审计事件 | 切换有测试 |
| T4 | 与 PRD-117/203 边界文档 | 边界说明齐全 |
| T5 | 验收试运行：模拟限流与切换 | 不绕登录墙；无密钥 |

## 6. T5 验收标准

1. 注入故障/限流场景后 doctor 四态（healthy/degraded/failed/throttled）与 JSON 一一对应；
2. 主源 failed 自动切备 + `source_failover` 审计事件；恢复切回留痕；
3. 加载器拒绝 auth≠none / data_class≠public / 缺 tos_url 的条目（违规样例测试）；
4. 拉取记录带 source_id 可追溯；机会数据无个人投递信息断言；
5. 全程零密钥、无登录墙绕过（扫描+代码路径断言）。

## 7. 借鉴划界

- [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)：License API 实测 **MIT**。仅借鉴"公开源能力层+doctor+主备"形态，不复制代码与文案；注册表 schema/健康状态机/审计事件为本仓原创（对齐既有 source-monitor 纪律）。
- 与日报原文的差异修正：无。
