# -*- coding: utf-8 -*-
"""PRD-337/T3（trend issue #1616 的 T3 环节）：公开信息聚合来源红线闸门。

按 T1 设计（docs/plans/2026-11-09-prd-337-public-info-aggregate-design.md）
§4/R1/R2 落地，消费 T2 public_info_aggregate 报告（注入式只读）：

  - ERROR_CODES 词表封闭（§4 三码）：SOURCE_BLOCKED / SOURCE_UNREACHABLE /
    ENTRY_INCOMPLETE；
  - source_gate(source_id)：R1 词表复核——来源 ∉ SOURCE_VOCAB 拒绝落库
    （词表封闭：不在词表的来源本就不存在）；
  - entry_gate(entry)：R2 三件套复核——{source_id, url, captured_at} 缺任一
    拒绝落库（ENTRY_INCOMPLETE；T2 已丢不完整条目，闸门兜底复核全条目）；
  - persist_gate(report)：落库前置闸门——报告 schema 钉值复核；entries 逐条
    过 source_gate + entry_gate，违例逐条显形；blocked[] 全量保留显形并按
    三码归类计数——**全部 blocked（entries=[]）也是如实结果**，报告可落库
    （gate=allow_empty，「一无所获」零伪装成有获）；
  - classify_blocked(report)：blocked 原因按三码归类（报告直读，复核面板用）。

零网络零凭证零投递（R3/R4，AST 同表预埋）；示例全虚构占位。
测试：tests/test_prd337_t3_aggregate_gate.py
"""
from __future__ import annotations

from typing import Any

from public_info_aggregate import AGG_SCHEMA, SOURCE_VOCAB

GATE_SCHEMA = "aggregate-persist-gate/v1"
ERROR_CODES = ("SOURCE_BLOCKED", "SOURCE_UNREACHABLE", "ENTRY_INCOMPLETE")


def source_gate(source_id: str) -> bool:
    """R1 词表复核：来源须在封闭词表内。"""
    return source_id in SOURCE_VOCAB


def entry_gate(entry: dict[str, Any]) -> list[str]:
    """R2 三件套复核：{source_id, url, captured_at} 缺任一拒绝落库。"""
    missing = []
    if not source_gate(str(entry.get("source_id") or "")):
        missing.append("source_id")
    if not str(entry.get("url") or "").strip():
        missing.append("url")
    if not str(entry.get("captured_at") or "").strip():
        missing.append("captured_at")
    return missing


def classify_blocked(report: dict[str, Any]) -> dict[str, int]:
    """blocked[] 按三码归类计数（§4 三码封闭）。"""
    counts = {code: 0 for code in ERROR_CODES}
    for b in report.get("blocked", []):
        reason = str(b.get("reason", ""))
        for code in ERROR_CODES:
            if reason.startswith(code) or code in reason:
                counts[code] += 1
                break
    return counts


def persist_gate(report: dict[str, Any]) -> dict[str, Any]:
    """落库前置闸门（§4/R2）：entries 逐条复核，blocked 全显形保留。"""
    offending: list[dict[str, Any]] = []
    reasons: list[str] = []
    if report.get("schema") != AGG_SCHEMA:
        reasons.append(f"报告 schema 钉值不符：{report.get('schema')!r}")
    for i, entry in enumerate(report.get("entries", [])):
        missing = entry_gate(entry)
        if missing:
            offending.append({"index": i, "error_code": "ENTRY_INCOMPLETE",
                              "detail": f"三件套缺 {missing}"})
    entries = report.get("entries", [])
    blocked = report.get("blocked", [])
    if entries and not report.get("generated_at"):
        reasons.append("报告缺 generated_at（时间溯源缺失）")
    gate = "reject" if (offending or reasons) else (
        "allow_empty" if not entries else "allow")
    return {"schema": GATE_SCHEMA, "gate": gate,
            "entries_checked": len(entries),
            "blocked_counts": classify_blocked(report),
            "blocked_visible": len(blocked),
            "offending": offending, "reasons": reasons,
            "note": ("全部来源 blocked——entries=[] 一无所获也是如实结果，"
                     "blocked 全显形（零伪装）" if gate == "allow_empty"
                     else "聚合报告为背景参考——求职动作走既有批准门（R4 零投递）")}
