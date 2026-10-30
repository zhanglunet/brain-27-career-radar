#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-204/T2（trend #1021）：求职状态捕获与更新——事件到状态映射最小实现。

按 PRD-204/T1 设计实现 T2 范围：
  事件类型：applied（投递）/ rejected（被拒）/ interview（面试）/ offer（offer）/ withdrawn（撤回）；
  状态模型：每条记录 {company, role, status, last_event, events: [...], updated_at}；
  事件到状态映射正确（applied→submitted、rejected→rejected 等）；
  零网络；示例全虚构。
"""
from __future__ import annotations

from typing import Any

EVENT_STATUS_MAP = {
    "applied": "submitted",
    "rejected": "rejected",
    "interview": "interviewing",
    "offer": "offer_received",
    "withdrawn": "withdrawn",
}


class JobStateMemory:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}

    def record_event(self, company: str, role: str, event_type: str, at: str,
                     note: str = "") -> dict[str, Any]:
        key = f"{company}::{role}"
        if key not in self.records:
            self.records[key] = {
                "company": company, "role": role, "status": "unknown",
                "events": [], "updated_at": "",
            }
        rec = self.records[key]
        new_status = EVENT_STATUS_MAP.get(event_type)
        if new_status is None:
            raise ValueError(f"未知事件类型: {event_type}")
        rec["status"] = new_status
        rec["last_event"] = event_type
        rec["updated_at"] = at
        rec["events"].append({"event": event_type, "at": at, "note": note})
        return rec

    def get_active(self) -> list[dict[str, Any]]:
        """获取非终态（非 rejected/withdrawn）的进行中条目。"""
        return [r for r in self.records.values()
                if r["status"] not in ("rejected", "withdrawn")]

    def export(self) -> list[dict[str, Any]]:
        return list(self.records.values())
