#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-232/T2（trend #1161）：任务队列实现——四状态流转全程留痕。

按 T1 设计（openbot 只借本地工作台 + 任务队列形态）实现：
  TaskQueue：四状态（待投递 queued / 跟进中 following / 面试准备 interviewing /
  已拒绝复盘 rejected）流转 + 全程留痕（transition_events 只追加）。
  每次流转写 {from, to, at, reason}；非法流转拒绝；终态（rejected）不可再迁移。
零网络；全合成。测试：tests/test_task_queue_t2.py
"""
from __future__ import annotations

from typing import Any

STATUSES = ("queued", "following", "interviewing", "rejected")
VALID_TRANSITIONS = {
    "queued": {"following", "rejected"},
    "following": {"interviewing", "rejected"},
    "interviewing": {"rejected"},
    "rejected": set(),
}


class QueueError(ValueError):
    """非法流转（状态机不允许）。"""


class TaskQueue:
    """四状态任务队列（全程留痕）。"""

    def __init__(self) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []

    def add(self, task_id: str, company: str, role: str, at: str) -> dict[str, Any]:
        if task_id in self.tasks:
            raise QueueError(f"任务已存在：{task_id!r}")
        self.tasks[task_id] = {
            "task_id": task_id, "company": company, "role": role,
            "status": "queued", "created_at": at, "updated_at": at,
        }
        self.events.append({"task_id": task_id, "from": None, "to": "queued",
                            "at": at, "reason": "入库"})
        return self.tasks[task_id]

    def transition(self, task_id: str, to_status: str, *, reason: str = "",
                   at: str | None = None) -> dict[str, Any]:
        task = self.tasks.get(task_id)
        if not task:
            raise QueueError(f"任务不存在：{task_id!r}")
        current = task["status"]
        if to_status not in VALID_TRANSITIONS.get(current, set()):
            raise QueueError(f"非法流转：{current} → {to_status}")
        moment = at or ""
        task["status"] = to_status
        task["updated_at"] = moment
        self.events.append({"task_id": task_id, "from": current, "to": to_status,
                            "at": moment, "reason": reason})
        return task

    def export(self) -> list[dict[str, Any]]:
        return list(self.tasks.values())

    def export_events(self) -> list[dict[str, Any]]:
        return list(self.events)
