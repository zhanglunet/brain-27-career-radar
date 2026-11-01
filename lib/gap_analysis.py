#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-231/T2：缺口分析实现——目标机会要求 vs 当前画像。

按 T1 设计（docs/plans/2026-10-26-growth-path-design.md）§三实现：
  analyze_gaps(opportunity, profile) → {gaps, hard_gates}：
    - 机会 requirements 逐条 vs 画像技能条目（ProfileSkillEntry 视图）比对，
      产出 GapItem（category/subject/requiredLevel/currentLevel/severity/source）
    - 每项缺口 source.quote 强制为机会原文逐字摘录（可溯源，验收口径）
    - SkillLevel 0–3；severity = round3(levelGap/3 × 硬性系数)；必需 1.0 / 优先 0.6；
      levelGap=0 不生成缺口
    - hard_gate 类（博士硬性/已截止/地区不符）severity 恒 1，单列不进路径
    - 画像无对应证据按 L0 处理；profileEvidence 记录画像侧证据
零网络；全合成；测试：tests/test_prd231_t2_gaps.py
"""
from __future__ import annotations

import re
from typing import Any

GAP_CATEGORIES = ("skill", "experience", "credential", "hard_gate")
ESSENTIAL_WORDS = ("essential", "required", "必须", "必需")
PREFERRED_WORDS = ("desirable", "preferred", "优先考虑", "优先")

_SKILL_LEVEL_RE = re.compile(r"(?:要求|需|掌握).*?L([0-3])", re.IGNORECASE)
_LEVEL_TOKEN_RE = re.compile(r"\bL([0-3])\b")


def _tone_of(text: str) -> float:
    low = text.lower()
    if any(w in low for w in ESSENTIAL_WORDS):
        return 1.0
    if any(w in low for w in PREFERRED_WORDS):
        return 0.6
    return 1.0  # 默认必需语气（保守）


def _required_level(text: str) -> int | None:
    m = _LEVEL_TOKEN_RE.search(text)
    return int(m.group(1)) if m else None


def _profile_level(subject: str, profile_skills: list[dict[str, Any]]) -> tuple[int, list[str]]:
    """画像侧当前等级：命中规范名取其 level 与证据；无证据按 L0。"""
    for entry in profile_skills:
        if entry.get("subject") == subject:
            evidence = list(entry.get("evidence", []))
            level = int(entry.get("level", 0)) if evidence else 0
            return level, evidence
    return 0, []


def analyze_gaps(opportunity: dict[str, Any],
                 profile_skills: list[dict[str, Any]]) -> dict[str, Any]:
    """目标机会 vs 画像 → 缺口清单（每项可溯源到机会原文）。

    opportunity.requirements 条目：{subject, level?, tone?, quote, field,
    category?, hard_gate?}。
    """
    gaps: list[dict[str, Any]] = []
    hard_gates: list[dict[str, Any]] = []
    for req in opportunity.get("requirements", []):
        quote = str(req.get("quote", "")).strip()
        if not quote:
            continue  # 无原文出处不生成（溯源强制）
        subject = str(req.get("subject", "")).strip()
        if not subject:
            continue
        category = req.get("category")
        if req.get("hard_gate"):
            hard_gates.append({
                "category": "hard_gate", "subject": subject,
                "requiredLevel": None, "currentLevel": None, "severity": 1,
                "source": {"quote": quote, "field": req.get("field", "requirements")},
                "profileEvidence": [], "status": "open",
            })
            continue
        if category not in ("skill", "experience", "credential"):
            category = "skill"
        required = req.get("level")
        if required is None:
            required = _required_level(quote)
        if required is None:
            continue  # 无法定级不臆判
        current, evidence = _profile_level(subject, profile_skills)
        level_gap = max(0, required - current)
        if level_gap == 0:
            continue  # levelGap=0 不生成缺口
        severity = round((level_gap / 3) * _tone_of(quote), 3)
        gaps.append({
            "opportunityId": opportunity.get("opportunity_id", ""),
            "category": category,
            "subject": subject,
            "requiredLevel": required,
            "currentLevel": current,
            "severity": severity,
            "source": {"quote": quote, "field": req.get("field", "requirements")},
            "profileEvidence": evidence,
            "status": "open",
        })
    return {"schema": "gap-analysis/v1",
            "opportunityId": opportunity.get("opportunity_id", ""),
            "gaps": gaps, "hard_gates": hard_gates}
