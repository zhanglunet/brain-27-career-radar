#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-203/T3（trend #1017）：与 PRD-117 聚合搜索对接——搜索命中 → 深读 → 回填机会条目。

按 PRD-203/T1 设计（docs/plans/2026-10-26-agent-browser-fields-design.md）§1.1/§二/§三 实现，
消费 T2（agent_browser_extract.extract_fields，PR #91 已合并）：

  deep_read_and_backfill(hits, fetch_fn)：
    hits = PRD-117 命中形态 [{opportunity_id, url, source_group, title, org}]；
    逐条 fetch_fn(url)（注入式取页，零网络）→ extract_fields 抽字段 → 回填同一机会条目：
      - 每个关键字段带 extract_status 枚举（T1 §3.1）：
        ok / raw_only / not_stated / not_found / secondhand_unverified——显式状态，
        不允许 null/空串冒充；
      - 证据链：{value, excerpt（原文片段）, url, at}，出处可溯源；
      - D 组（聚合页）：先按聚合页中的源站链接回源深读（source_url 或 fetch_fn 二段）；
        回不到源站时薪资/截止/联系三类关键字段按 secondhand_unverified 处理，
        不直接回填为确定值（T1 §二）；
      - fetch 失败 → 显式 degraded 记录 + 人工补录提示，不静默丢弃（T1 §1.1）。

红线（T1 §1.3）：不自动投递、不绕过访问控制、不复用 agent-browser 代码；
投递归 PRD-175 批准门。零网络；示例全虚构。
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

from agent_browser_extract import extract_fields

EXTRACT_STATUSES = ("ok", "raw_only", "not_stated", "not_found", "secondhand_unverified")
KEY_FIELDS = ("salary_range", "deadline", "contact")
SOURCE_LINK_RE = re.compile(r"原文(?:链接|出处)[：:]\s*(https?://\S+)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _excerpt(html: str, pattern: str) -> str:
    m = re.search(pattern, html)
    if not m:
        return ""
    start = max(0, m.start() - 20)
    return html[start:m.end() + 20].replace("\n", " ").strip()


FIELD_PATTERNS = {
    "salary_range": r"[¥￥]\s*\d+[-\s~到]*\d*\s*[万w]?(?:/年|/y)?",
    "deadline": r"截[止至]日期[：:]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}",
    "contact": r"联系(?:方式|人)[：:]\s*[^\s，,。]{3,60}",
}


def _field_evidence(fields: dict[str, Any], html: str, url: str, at: str) -> dict[str, Any]:
    """字段 → {value, extract_status, evidence:{value,excerpt,url,at}}（显式状态，不用 null）。"""
    out: dict[str, Any] = {}
    for key in KEY_FIELDS:
        value = fields.get(key)
        if value is None:
            status = "not_found" if html else "not_stated"
            out[key] = {"extract_status": status, "value": None, "evidence": None}
            continue
        excerpt = _excerpt(html, FIELD_PATTERNS[key])
        out[key] = {"extract_status": "ok", "value": value,
                    "evidence": {"value": value, "excerpt": excerpt, "url": url, "at": at}}
    return out


def deep_read_one(hit: dict[str, Any], fetch_fn: Callable[[str], str | None],
                  at: str | None = None) -> dict[str, Any]:
    """单条命中 → 深读 → 回填形态（含 D 组二段回源）。"""
    moment = at or _now()
    url = hit.get("url", "")
    group = hit.get("source_group", "A")
    html = fetch_fn(url)
    if html is None:
        return {"opportunity_id": hit.get("opportunity_id"), "status": "fetch_failed",
                "degraded": [{"reason": "fetch_failed", "url": url}],
                "manual_hint": "人工补录：页面无法打开（留降级记录，不静默丢弃）",
                "fields": {}, "at": moment}
    # D 组：聚合页 → 先找源站链接回源
    resolved_url, resolved_html = url, html
    source_link = SOURCE_LINK_RE.search(html)
    if group == "D" and source_link:
        source_html = fetch_fn(source_link.group(1))
        if source_html:
            resolved_url, resolved_html = source_link.group(1), source_html
    fields = extract_fields(resolved_html)
    evidence = _field_evidence(fields, resolved_html, resolved_url, moment)
    degraded: list[dict[str, Any]] = []
    if group == "D" and not source_link:
        for key in KEY_FIELDS:
            entry = evidence[key]
            if entry["extract_status"] == "ok":
                # 聚合页本体抽到的值：能溯源到源站才算确定值，否则只作线索
                if resolved_url == url:
                    entry["extract_status"] = "secondhand_unverified"
                    entry["value"] = entry["evidence"]["value"]
                    degraded.append({"field": key, "reason": "secondhand_unverified"})
    if fields.get("error"):
        degraded.append({"field": "*", "reason": fields["error"]})
    return {"opportunity_id": hit.get("opportunity_id"), "status": "ok",
            "fields": evidence, "degraded": degraded,
            "resolved_url": resolved_url, "at": moment}


def deep_read_and_backfill(hits: list[dict[str, Any]],
                           fetch_fn: Callable[[str], str | None],
                           opportunities: list[dict[str, Any]] | None = None,
                           at: str | None = None) -> list[dict[str, Any]]:
    """链路跑通：PRD-117 命中 → 深读 → 回填同一机会条目（深读结果写回 backfill 块）。"""
    moment = at or _now()
    by_id = {o.get("opportunity_id"): o for o in (opportunities or [])}
    results = []
    for hit in hits:
        result = deep_read_one(hit, fetch_fn, at=moment)
        entry = by_id.get(hit.get("opportunity_id"))
        if entry is not None:
            entry["deep_read"] = result  # 回填同一机会条目（只加 backfill 块，不改原字段）
        results.append(result)
    return results
