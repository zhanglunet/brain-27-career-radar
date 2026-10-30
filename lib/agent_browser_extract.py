#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-203/T2（trend #1016）：JS 渲染页结构化抽取——fixture 驱动，零网络。"""
from __future__ import annotations

import re
from typing import Any


def extract_fields(html: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "salary_range": None, "deadline": None, "contact": None,
        "phd_required": None, "enrollment_required": None, "error": None,
    }
    if not html or not html.strip():
        result["error"] = "empty page"
        return result
    m = re.search(r"[¥￥]\s*(\d+)[-\s~到]*(\d+)?\s*[万w]?(?:/年|/y)?", html)
    if m:
        lo = m.group(1); hi = m.group(2) or lo
        unit = "万/年" if ("万" in m.group(0) or "w" in m.group(0).lower()) else "千/月"
        result["salary_range"] = f"{lo}-{hi}{unit}"
    m = re.search(r"截[止至]日期[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})", html)
    if m:
        result["deadline"] = m.group(1)
    m = re.search(r"联系(?:方式|人)[：:]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|详见原文)", html)
    if m:
        result["contact"] = m.group(1)
    result["enrollment_required"] = "在读证明" in html
    result["phd_required"] = bool(re.search(r"\bPhD\b|博士(?:学位|后)", html, re.I))
    return result


def batch_extract(pages: list[dict[str, str]]) -> list[dict[str, Any]]:
    out = []
    for page in pages:
        r = extract_fields(page.get("html", ""))
        r["url"] = page.get("url", "")
        if not any(r.get(k) for k in ("salary_range", "deadline", "contact")):
            r["error"] = r.get("error") or "no fields extracted"
        out.append(r)
    return out
