# -*- coding: utf-8 -*-
"""PRD-365/T2（trend issue #1644 的 T2 环节）：投递批准门收件箱最小实现。

按 T1 设计（docs/plans/2026-11-11-prd-365-approval-inbox-design.md）
§3.1/§3.2/§4 实现：

  - collect(*, delivery_pending=None, ref_disambiguations=None,
    profile_drafts=None)：三源只读汇聚（R2）——PRD-175 批准门待批投递、
    PRD-295 @引用解析歧义候选（REF_AMBIGUOUS 人工选）、PRD-281 档案改动
    草稿确认 → 条目 {item_id, kind, source_ref, fingerprint, candidates?,
    reason, state} 缺一 INBOX_ITEM_INCOMPLETE 拒绝入箱（R3；fingerprint 与
    PRD-351 重放包 snapshot_digest 同源）；
  - approve(item, *, by, at, choice=None)：歧义项必带选中候选（§6.1 裁决
    approve 携带 candidate）——不带 INBOX_CHOICE_REQUIRED 显形拒绝；
  - InboxLedger：append-only（R4）——approve/reject 人批留痕；重复裁决
    INBOX_DOUBLE_DECIDE、未知 id、携带投递载荷 INBOX_AUTO_EXEC_ATTEMPT
    （R1 零投递触发——投递动作仍走 PRD-175 批准门由人执行）显形拒绝；
  - view(kind)：kind 过滤视图。

kind 词表封闭：delivery_approval / ref_disambiguation /
profile_draft_confirm。零网络；示例全虚构占位。
测试：tests/test_prd365_t2_approval_inbox.py
"""
from __future__ import annotations

import copy
from typing import Any

INBOX_SCHEMA = "approval-inbox/v1"
ITEM_KINDS = ("delivery_approval", "ref_disambiguation",
              "profile_draft_confirm")
ERROR_CODES = ("INBOX_ITEM_INCOMPLETE", "INBOX_DOUBLE_DECIDE",
               "INBOX_AUTO_EXEC_ATTEMPT", "INBOX_CHOICE_REQUIRED")
_EXEC_KEYS = ("action", "deliver", "execute", "submit", "apply")


class InboxError(ValueError):
    """收件箱违规——显形拒绝。"""


def _item(item_id: str, kind: str, source_ref: str, fingerprint: str,
          reason: str, candidates: list | None = None) -> dict[str, Any]:
    return {"item_id": item_id, "kind": kind, "source_ref": source_ref,
            "fingerprint": fingerprint, "candidates": candidates or [],
            "reason": reason, "state": "pending",
            "decided_by": None, "decided_at": None, "reject_reason": None,
            "chosen_candidate": None}


def collect(*, delivery_pending: list[dict[str, Any]] | None = None,
            ref_disambiguations: list[dict[str, Any]] | None = None,
            profile_drafts: list[dict[str, Any]] | None = None,
            fingerprint: str = "sha16:none（占位）",
            at: str = "") -> list[dict[str, Any]]:
    """三源只读汇聚（R2）；四件套缺一拒绝入箱并显形。"""
    items: list[dict[str, Any]] = []
    incomplete: list[str] = []
    n = 0

    def _add(kind: str, source_ref: str, fp: str, reason: str,
             candidates: list | None = None):
        nonlocal n
        n += 1
        it = _item(f"item-{n:03d}", kind, source_ref, fp, reason, candidates)
        missing = [k for k in ("item_id", "kind", "source_ref", "fingerprint",
                               "reason") if not it.get(k)]
        if missing or kind not in ITEM_KINDS:
            incomplete.append(f"{kind or '(空 kind)'} 缺 {missing or 'kind 非法'}")
            return
        items.append(it)

    for d in delivery_pending or []:
        _add("delivery_approval",
             str(d.get("source_ref") or "approval-gate/v1#pending"),
             str(d.get("fingerprint") or fingerprint),
             str(d.get("reason") or ""))   # reason 必填——缺失即 INCOMPLETE
    for r in ref_disambiguations or []:
        _add("ref_disambiguation", str(r.get("source_ref") or "ref-resolution"),
             str(r.get("fingerprint") or fingerprint),
             str(r.get("reason") or "歧义候选需人工选（占位）"),
             r.get("candidates") or [])
    for p in profile_drafts or []:
        _add("profile_draft_confirm",
             str(p.get("source_ref") or "profile-draft"),
             str(p.get("fingerprint") or fingerprint),
             str(p.get("reason") or ""))   # reason 必填
    if incomplete:
        raise InboxError(f"INBOX_ITEM_INCOMPLETE：{'；'.join(incomplete)}")
    return items


class InboxLedger:
    """收件箱账本（R4）：append-only；approve/reject 只改状态零投递（R1）。"""

    def __init__(self) -> None:
        self._items: dict[str, dict[str, Any]] = {}
        self._events: list[dict[str, Any]] = []

    def add(self, items: list[dict[str, Any]]) -> list[str]:
        added = []
        for it in items:
            if it["item_id"] in self._items:
                raise InboxError(f"INBOX_DOUBLE_DECIDE：{it['item_id']} 已在箱")
            self._items[it["item_id"]] = copy.deepcopy(it)
            self._events.append({"op": "add", "item_id": it["item_id"]})
            added.append(it["item_id"])
        return added

    def _decide(self, item_id: str, state: str, *, by: str, at: str,
                reason: str = "", choice: str | None = None,
                payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if payload and any(k in payload for k in _EXEC_KEYS):
            raise InboxError("INBOX_AUTO_EXEC_ATTEMPT：裁决携带投递载荷——"
                             "收件箱零投递触发（R1），投递走 PRD-175 批准门由人执行")
        it = self._items.get(item_id)
        if not it:
            raise InboxError(f"未知 item_id：{item_id!r}")
        if it["state"] != "pending":
            raise InboxError(f"INBOX_DOUBLE_DECIDE：{item_id} 已裁决"
                             f"（{it['state']}）——重复裁决显形拒绝")
        if (state == "approved" and it["kind"] == "ref_disambiguation"):
            if not choice:
                raise InboxError("INBOX_CHOICE_REQUIRED：歧义项 approve 必带"
                                 "选中候选（§6.1 裁决 approve 携带 candidate）")
            if choice not in it["candidates"]:
                raise InboxError(f"INBOX_CHOICE_REQUIRED：候选 {choice!r} 不在"
                                 "候选列表——只能选列出的候选")
            it["chosen_candidate"] = choice
        it["state"] = state
        it["decided_by"] = by
        it["decided_at"] = at
        if reason:
            it["reject_reason"] = reason
        self._events.append({"op": state.lower(), "item_id": item_id,
                             "by": by, "at": at})
        return dict(it)

    def approve(self, item_id: str, *, by: str, at: str,
                choice: str | None = None,
                payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._decide(item_id, "approved", by=by, at=at, choice=choice,
                            payload=payload)

    def reject(self, item_id: str, *, by: str, at: str, reason: str = "",
              payload: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._decide(item_id, "rejected", by=by, at=at, reason=reason,
                            payload=payload)

    def view(self, kind: str | None = None) -> list[dict[str, Any]]:
        return [copy.deepcopy(it) for it in self._items.values()
                if kind is None or it["kind"] == kind]

    @property
    def events(self) -> list[dict[str, Any]]:
        return [dict(e) for e in self._events]
