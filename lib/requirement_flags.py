#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-203/T4（trend #1018）：机会页深读——截止日期与硬性要求显式标注。

按 PRD-203/T1 设计（docs/plans/2026-10-26-agent-browser-fields-design.md）§四 实现，
消费 T3（deep_read_pipeline.py 的回填结果，PR #93 已合并）：

  flag_requirements(opportunities, user_conditions, *, now)：
    用户条件 vs 机会硬性要求逐项对照，**不符合的机会被显式标出而非静默混入**：
      - phd_required=True 且用户未声明博士 → 硬性要求不符（mismatch）
      - enrollment_required=True 且用户声明不能提供在读证明 → 不符
      - deadline 已过（对照 now，时区口径 UTC）→ expired 标注
    每个机会回填 requirements 块：{flags: [{field, requirement, user_value,
    mismatch}], mismatched, expired}——展示层据此排序/折叠，不静默；
    用户未声明该项条件 → mismatch=None（无法判定，不武断标红）。

红线：只标注不投递（投递归 PRD-175 批准门）；零网络；示例全虚构。
测试：tests/test_prd203_t4_flags.py
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _parse_deadline(deadline: str | None) -> datetime | None:
    if not deadline:
        return None
    try:
        dt = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)  # 无时区的截止日按 UTC 口径（T1 §3）
    return dt


def flag_requirements(opportunities: list[dict[str, Any]],
                      user_conditions: dict[str, Any], *,
                      now: str | None = None) -> list[dict[str, Any]]:
    """深读结果 × 用户条件 → 硬性要求标注（不符显式标出，不静默混入）。"""
    moment = datetime.fromisoformat(now) if now else datetime.now(timezone.utc)
    user_phd = user_conditions.get("phd")             # True/False/None（未声明）
    user_enroll = user_conditions.get("enrollment_proof_ok")
    out = []
    for opp in opportunities:
        deep = opp.get("deep_read") or {}
        fields = deep.get("fields") or {}
        flags: list[dict[str, Any]] = []

        phd_req = (fields.get("phd_required") or {}).get("value")
        if phd_req is True:
            mismatch = None if user_phd is None else (user_phd is not True)
            flags.append({"field": "phd_required", "requirement": True,
                          "user_value": user_phd, "mismatch": mismatch})

        enroll_req = (fields.get("enrollment_required") or {}).get("value")
        if enroll_req is True:
            mismatch = None if user_enroll is None else (user_enroll is not True)
            flags.append({"field": "enrollment_required", "requirement": True,
                          "user_value": user_enroll, "mismatch": mismatch})

        deadline = (fields.get("deadline") or {}).get("value")
        dl_dt = _parse_deadline(deadline)
        expired = bool(dl_dt and dl_dt < moment)
        if dl_dt is not None:
            flags.append({"field": "deadline", "requirement": deadline,
                          "user_value": None,
                          "mismatch": expired})

        opp["requirements"] = {
            "flags": flags,
            "mismatched": any(f["mismatch"] is True for f in flags),
            "expired": expired,
        }
        out.append(opp)
    return out


def sort_by_fit(opportunities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """展示排序：符合条件（且未过期）在前，不符/过期显式靠后——不静默混入。"""
    def key(opp):
        req = opp.get("requirements") or {}
        return (1 if req.get("mismatched") else 0,
                1 if req.get("expired") else 0)
    return sorted(opportunities, key=key)
