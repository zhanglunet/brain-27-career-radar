# -*- coding: utf-8 -*-
"""PRD-337/T2（trend issue #1616 的 T2 环节）：公开信息聚合最小实现。

按 T1 设计（docs/plans/2026-11-09-prd-337-public-info-aggregate-design.md）
§3.1/§3.2/§3.3/§4 实现：

  - SOURCE_VOCAB：来源词表封闭四项（company_site/public_job_page/
    public_event/public_academic）——扩展须论证纯公开+零凭证+可 GET（R1）；
  - aggregate(target, fetchers, *, now)：一键聚合（§3.3）——逐来源注入式
    fetch（零内置站点硬编码，测试全 stub）；单来源失败 → blocked[] 显形
    （SOURCE_BLOCKED/SOURCE_UNREACHABLE，不重试不伪装）；条目三件套
    （source_id/url/captured_at）缺一丢弃显形（ENTRY_INCOMPLETE 不落库）；
    全部来源 blocked → 报告仍产出（entries=[]，一无所获也是如实结果）；
  - **零推理零投递**（R4）：聚合只并排不研判——结果零评价零倾向判断；
    求职动作仍走批准门（本模块零投递/零批准门调用，T4 AST 断言预埋）；
  - **零凭证**（R3）：采集器接口零凭证注入符号（T4 AST 断言预埋）。

零网络（fetch 注入式）；示例全虚构占位。
测试：tests/test_prd337_t2_aggregate.py
"""
from __future__ import annotations

from typing import Any, Callable

SOURCE_VOCAB = ("company_site", "public_job_page", "public_event",
                "public_academic")
AGG_SCHEMA = "public-info-aggregate/v1"


class SourceGateError(ValueError):
    """来源词表外/来源配置非法（词表封闭 R1）。"""


def aggregate(target: dict[str, Any],
              fetchers: dict[str, Callable[[dict[str, Any]], list[dict[str, Any]]]],
              *, now: str) -> dict[str, Any]:
    """一键聚合（§3.3）：逐来源注入式 fetch → 校验三件套 → 排序输出。

    target：{"kind": "company|person", "name": "…（占位）"}；
    fetchers：{source_id: fetch_fn(target) → entries}——采集器注入（测试
    stub/生产实现接既有 monitor 只读 GET 形态）；失败/拒绝 → blocked[]。
    返回 public-info-aggregate/v1 报告。
    """
    entries: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for source_id in SOURCE_VOCAB:
        fetch = fetchers.get(source_id)
        if fetch is None:
            continue  # 未接来源跳过（词表封闭：不在词表的来源本就不存在）
        try:
            rows = fetch(target)
        except Exception as exc:  # 采集失败显形——不重试不伪装
            blocked.append({"source_id": source_id,
                            "reason": f"SOURCE_BLOCKED：{exc}"})
            continue
        for row in rows or []:
            entry = {"source_id": source_id, "url": row.get("url"),
                     "captured_at": now, "summary": row.get("summary", "")}
            if not entry["url"] or not entry["summary"]:
                blocked.append({"source_id": source_id,
                                "reason": "ENTRY_INCOMPLETE：条目缺 url/summary（不落库）"})
                continue
            entries.append(entry)
    entries.sort(key=lambda e: (e["source_id"], e["url"]))
    blocked.sort(key=lambda b: b["source_id"])
    return {
        "schema": AGG_SCHEMA,
        "target": {"kind": target.get("kind"), "name": target.get("name")},
        "generated_at": now,
        "entries": entries,
        "blocked": blocked,
        "note": "仅公开来源聚合，背景参考——求职动作走既有批准门（R4 零投递）",
    }
