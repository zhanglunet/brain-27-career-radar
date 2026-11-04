# -*- coding: utf-8 -*-
"""PRD-295/T3（trend issue #1478）：求职记录审计与批准门不变闸门。

按 T1 设计（docs/plans/2026-11-04-prd-295-at-opportunity-profile-ref-design.md）
§5/§6/§7 实现，叠加 T2 record_ref（解析器不变，闸门消费其产物）：

  - TaskRefAudit：求职记录审计（§6）——append-only 只增不删、成败都记、
    与工作台事件链同形态（task_id 关联）；
  - resolve_for_task(...): 解析+留痕一步走（供工作台调用的唯一入口）；
  - payload_for_gate(resolution)：把 Resolution 转成 D1–D6 批准门 payload
    的一部分——**只读投影**（机会 id/档案版本/摘要指纹），载荷一致防调包
    校验在门内照常适用；
  - **批准门不变**（R1）：本模块零 approval_dispatch 执行方法导入
    （T4 AST 断言预埋）；解析失败 → 不产出 payload、不触碰门（拒绝面与
    门面完全隔离）；
  - 错误码封闭：REF_* + PROFILE_VERSION_GONE 词表穷举。

零网络；示例全虚构占位。
测试：tests/test_prd295_t3_audit_gate.py
"""
from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

from record_ref import resolve  # noqa: F401  (REF 词表供封闭断言)

ERROR_CODES = ("REF_SYNTAX_ERROR", "REF_NOT_FOUND", "REF_AMBIGUOUS",
               "PROFILE_VERSION_GONE")
PAYLOAD_KEYS = {"opportunity_id", "profile_version", "profile_digest"}


class TaskRefAudit:
    """求职记录审计（§6）：append-only、task_id 关联、与工作台事件链同形态。"""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def log(self, raw: str, outcome: dict[str, Any] | None, *, at: str,
            task_id: str | None = None) -> dict[str, Any]:
        res = (outcome or {}).get("resolution", {})
        entry: dict[str, Any] = {"ts": at, "raw": raw,
                                 "kind": (outcome or {}).get("kind"),
                                 "task_id": task_id}
        if res.get("status") == "resolved":
            entry.update({"status": "resolved", "candidates": 1,
                          "resolved_ids": [outcome.get("opportunity_id")
                                           or outcome.get("profile_version")]})
        else:
            entry.update({"status": "refused", "candidates": res.get("candidates", []),
                          "error_code": res.get("error_code"),
                          "detail": res.get("detail")})
        self.records.append(entry)  # 只增不删
        return dict(entry)


def resolve_for_task(raw: str, opportunities: list[dict[str, Any]],
                     profile_versions: list[dict[str, Any]], *, at: str,
                     task_id: str, audit: TaskRefAudit) -> dict[str, Any]:
    """解析+留痕一步走（工作台唯一入口；语法错也入审计）。"""
    try:
        outcome = resolve(raw, opportunities, profile_versions)
    except Exception as exc:  # RefSyntaxError——语法错也留痕
        entry = audit.log(raw, None, at=at, task_id=task_id)
        entry.update({"error_code": "REF_SYNTAX_ERROR", "detail": str(exc)})
        audit.records[-1] = entry
        return {"refused": True, "error_code": "REF_SYNTAX_ERROR",
                "detail": str(exc), "audit": entry}
    entry = audit.log(raw, outcome, at=at, task_id=task_id)
    if outcome["resolution"]["status"] == "refused":
        return {"refused": True,
                "error_code": outcome["resolution"].get("error_code",
                                                        "REF_NOT_FOUND"),
                "detail": outcome["resolution"].get("detail", ""), "audit": entry}
    return {"refused": False, "resolution": outcome, "audit": entry}


def payload_for_gate(resolution: dict[str, Any]) -> dict[str, Any]:
    """Resolution → D1–D6 门 payload 投影（只读；白名单键，载荷一致防调包
    由门内既有校验适用——本模块只做投影）。传入对象含白名单外顶层键即拒
    （投影边界显形，不静默吞）。"""
    unknown_top = set(resolution) - {"schema", "raw", "kind", "opportunity_id",
                                     "profile_version", "meta_summary",
                                     "resolution"}
    if unknown_top:
        raise ValueError(f"Resolution 顶层键越界：{sorted(unknown_top)}")
    if resolution.get("resolution", {}).get("status") != "resolved":
        raise ValueError("refused Resolution 不产出 payload（拒绝面与门面隔离）")
    payload: dict[str, Any] = {}
    if resolution.get("opportunity_id"):
        payload["opportunity_id"] = resolution["opportunity_id"]
    if resolution.get("profile_version"):
        payload["profile_version"] = resolution["profile_version"]
    digest = (resolution.get("meta_summary") or {}).get("profile_digest")
    if digest:
        payload["profile_digest"] = digest
    if not payload:
        raise ValueError("空 payload（解析产物缺 id 字段）")
    extra = set(payload) - PAYLOAD_KEYS
    if extra:
        raise ValueError(f"payload 键越界：{sorted(extra)}")
    return payload


if __name__ == "__main__":  # pragma: no cover
    # AST 红线自检（R1）：零 approval_dispatch 执行方法导入
    tree = ast.parse(Path(__file__).resolve().read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        mods = []
        if isinstance(node, ast.Import):
            mods = [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods = [node.module.split(".")[0]]
        for mod in mods:
            assert mod != "approval_dispatch", "解析/审计面导入了批准门执行方法"
    print("AST 红线自检通过（批准门不变）")
