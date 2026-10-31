#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-204/T3（trend #1022）：求职会话开启续跑注入——先给「进行中」概览。

按 PRD-204/T1 设计（docs/plans/2026-10-26-job-session-memory-design.md）实现，
消费 T2（job_state_memory.JobStateMemory，PR #92 已合并）：

  build_session_brief(memory)：新会话开场的「进行中」概览——
    - 摘要行：进行中 N 条（按状态计数：submitted / interviewing / offer_received）；
    - 每条进行中记录一行：公司 · 岗位 · 状态 · 最近事件与时间（零虚构，全部来自
      T2 状态记录，可复述）；
    - 终态条目（rejected/withdrawn）不进概览正文，只给计数（避免噪音）；
    - 最近事件时间倒序排列；
  验收口径「新会话可准确复述状态」：brief 文本对每条进行中记录都能准确复述出
  公司/岗位/状态/最近事件——测试逐条对账。

零网络；示例全虚构。
"""
from __future__ import annotations

from typing import Any

STATUS_LABELS = {
    "submitted": "已投递",
    "interviewing": "面试中",
    "offer_received": "已收到 offer",
    "rejected": "已拒绝",
    "withdrawn": "已撤回",
}


def build_session_brief(memory: Any) -> dict[str, Any]:
    """新会话开场注入：进行中概览（零虚构，字段全部来自状态记录）。"""
    active = sorted(memory.get_active(), key=lambda r: r.get("updated_at", ""), reverse=True)
    finished = [r for r in memory.export() if r not in active]
    counts: dict[str, int] = {}
    for r in active:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    lines = []
    for r in active:
        last = (r.get("events") or [{}])[-1]
        label = STATUS_LABELS.get(r["status"], r["status"])
        note = f"（{last['note']}）" if last.get("note") else ""
        lines.append(f"{r['company']} · {r['role']} · {label}"
                     f" · 最近事件：{last.get('event', r.get('last_event', ''))}"
                     f"@{r.get('updated_at', '')}{note}")
    return {
        "summary": f"进行中 {len(active)} 条：" +
                   "、".join(f"{STATUS_LABELS.get(s, s)} {c} 条" for s, c in counts.items())
                   if active else "当前没有进行中的求职条目",
        "items": lines,
        "finished_count": len(finished),
    }


def render_brief(brief: dict[str, Any]) -> str:
    """brief → 新会话注入文本（可复述形态）。"""
    out = [brief["summary"], ""]
    out += [f"- {ln}" for ln in brief["items"]]
    if brief["finished_count"]:
        out.append(f"（另有 {brief['finished_count']} 条已结束：拒绝/撤回，不占进行中）")
    return "\n".join(out) + "\n"
