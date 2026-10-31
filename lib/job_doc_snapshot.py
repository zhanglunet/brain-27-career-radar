#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-204/T4（trend #1023）：与 PRD-150 文档生成对接（状态喂给文档生成）。

按 PRD-204/T1 设计（docs/plans/2026-10-26-job-session-memory-design.md）§1.2/§6.3 实现，
消费 T2（job_state_memory.JobStateMemory，PR #92）：

  state_snapshot(memory)：文档生成时的**只读**状态快照（§1.2：PRD-150 生成时只读
    状态层，状态层不写 materials）——每条记录的 company/role/status/最近事件 +
    按状态分组计数；snapshot 与状态层解耦（深拷贝，外部改动不回写）；
  snapshot_digest(snapshot)：快照指纹——状态一变 digest 就变；文档记录该指纹，
    引用时可判断「是否引用了最新状态」（非最新 → 重新生成提示）；
  doc_context(memory)：喂给 PRD-150 生成器的最小上下文（进行中概览 + 快照指纹），
    附只读声明字段 readonly=True。

零网络；示例全虚构。测试：tests/test_prd204_t4_doc_snapshot.py
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

STATUS_LABELS = {
    "submitted": "已投递", "interviewing": "面试中", "offer_received": "已收到 offer",
    "rejected": "已拒绝", "withdrawn": "已撤回",
}


def state_snapshot(memory: Any) -> dict[str, Any]:
    """只读状态快照（深拷贝——文档侧改动不回写状态层，§1.2 划界）。"""
    records = copy.deepcopy(memory.export())
    active = [r for r in records if r["status"] not in ("rejected", "withdrawn")]
    counts: dict[str, int] = {}
    for r in active:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    items = []
    for r in sorted(active, key=lambda x: x.get("updated_at", ""), reverse=True):
        last = (r.get("events") or [{}])[-1]
        items.append({"company": r["company"], "role": r["role"],
                      "status": r["status"],
                      "status_label": STATUS_LABELS.get(r["status"], r["status"]),
                      "last_event": last.get("event", r.get("last_event", "")),
                      "updated_at": r.get("updated_at", "")})
    return {"schema": "job-state-snapshot/v1", "items": items,
            "counts": {"active": len(active), **counts},
            "finished_count": len(records) - len(active)}


def snapshot_digest(snapshot: dict[str, Any]) -> str:
    """快照指纹：状态一变 digest 就变（文档引用可判断是否最新）。"""
    return "snap-" + hashlib.sha256(
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]


def doc_context(memory: Any) -> dict[str, Any]:
    """喂给 PRD-150 生成器的最小上下文（只读；文档引用最新状态）。"""
    snapshot = state_snapshot(memory)
    return {"schema": "job-doc-context/v1", "readonly": True,
            "snapshot": snapshot, "snapshot_digest": snapshot_digest(snapshot),
            "note": "PRD-150 生成时只读本快照；状态层不写 materials（§1.2）"}
