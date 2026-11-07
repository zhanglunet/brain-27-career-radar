#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-232/T4（trend issue #1163）：批准门衔接——投递动作强制走 PRD-175 门。

按 T1 设计（docs/plans/2026-10-26-job-workbench-design.md）§4 全节实现：

  §4.1 投递动作清单（default-deny）：D1 投递(webform_submit)/D2 申请邮件
    (email_send)/D3 跟进邮件(email_send，**明确在列防绕过**)/D4 定稿导出
    (file_export_final)/D5 档案分享(profile_share)/D6 重新投递(全新请求全新
    批准，不复活旧记录)；清单外动作一律不存在（防过度拦截：本地草稿/评估/
    状态迁移不过门但留痕）。
  §4.2 单点收口 + 两段式：dispatch 是唯一允许引用门的模块（静态 import 图
    断言，G10）；request 只产生 pending 记录不连带执行；execute 只在
    approved 且未过期时经门完成（门内校验以 PRD-175 实现为准，工作台不重复
    实现也不得跳过）；preview 免费不算投递尝试（G12）；回执回写 approval_id
    对账（G11）。agent 调 requestApproval/execute → 结构性拒绝（G3）。
  §4.4 门禁用例：G1 无 approved 执行 → default-deny 拒绝；G2 未注册
    action_kind → 拒绝 + bypass_blocked；G3 agent 越权 → 拒绝 + 边界事件。

零网络；门以注入式 gate 接口表达（默认 deny 的内存实现，生产门为 PRD-175
gate.ts——工作台不重复实现）；全部标识占位。
测试：tests/test_prd232_t4_gate.py
"""
from __future__ import annotations

from typing import Any, Callable

#: §4.1 已注册 action_kind（PRD-175；default-deny：清单外一律不存在）
ACTION_KINDS = ("webform_submit", "email_send", "file_export_final", "profile_share")
#: §4.1 D1–D6 投递动作清单（工作台触发点 → action_kind 映射）
DELIVERY_ACTIONS = {
    "D1_submit_application": "webform_submit",
    "D2_send_application_email": "email_send",
    "D3_send_followup_email": "email_send",
    "D4_export_final": "file_export_final",
    "D5_export_profile_share": "profile_share",
    "D6_resubmit": "webform_submit",
}
APPROVAL_STATUSES = ("pending", "approved", "rejected", "expired")


class GateDenied(Exception):
    """门拒绝（default-deny）：携带子代号与说明，调用方留痕。"""

    def __init__(self, code: str, detail: str = ""):
        self.code = code
        super().__init__(f"{code}: {detail}" if detail else code)


class DefaultDenyGate:
    """PRD-175 门的注入式最小替身（default-deny 语义一致）。

    生产 gate.ts 由 PRD-175 提供；本替身用于 T4 门禁路径测试——工作台代码
    只依赖本接口形态（request/preview/execute 三面），不 import 生产实现。
    """

    def __init__(self) -> None:
        self.approvals: dict[str, dict[str, Any]] = {}
        self.audit: list[dict[str, Any]] = []  # append-only（§4.2 门侧审计）
        self._seq = 0

    def request_approval(self, action_kind: str, payload: dict[str, Any],
                         requested_by: str, *, at: str) -> dict[str, Any]:
        if action_kind not in ACTION_KINDS:
            self.audit.append({"type": "bypass_blocked", "action_kind": action_kind,
                               "requested_by": requested_by, "at": at})
            raise GateDenied("unregistered_action_kind",
                             f"{action_kind!r} 未在 PRD-175 注册（default-deny）")
        if requested_by.startswith("agent:"):
            self.audit.append({"type": "agent_boundary_violation",
                               "action_kind": action_kind,
                               "requested_by": requested_by, "at": at})
            raise GateDenied("agent_boundary_violation",
                             "agent 无权调用 requestApproval（§4.2 红线）")
        self._seq += 1
        approval_id = f"apr-{self._seq:04d}"
        self.approvals[approval_id] = {"approval_id": approval_id,
                                       "action_kind": action_kind,
                                       "payload": dict(payload),
                                       "status": "pending",
                                       "requested_by": requested_by, "at": at}
        self.audit.append({"type": "requested", "approval_id": approval_id,
                           "action_kind": action_kind, "at": at})
        return dict(self.approvals[approval_id])

    def decide(self, approval_id: str, decision: str, by: str, *,
               at: str) -> dict[str, Any]:
        if approval_id not in self.approvals:
            raise GateDenied("unknown_approval", approval_id)
        record = self.approvals[approval_id]
        if record["status"] != "pending":
            raise GateDenied("not_pending", f"{approval_id} 状态 {record['status']}")
        if by.startswith("agent:"):
            raise GateDenied("agent_boundary_violation", "decide 全员禁区（§3.4）")
        record["status"] = decision
        record["decided_by"] = by
        record["decided_at"] = at
        self.audit.append({"type": decision, "approval_id": approval_id, "at": at})
        return dict(record)

    def execute(self, approval_id: str, payload: dict[str, Any], *,
                at: str, now: str) -> dict[str, Any]:
        if approval_id not in self.approvals:
            self.audit.append({"type": "execute_denied", "approval_id": approval_id,
                               "at": at, "reason": "unknown"})
            raise GateDenied("default_deny", f"无 approved 记录：{approval_id!r}（G1）")
        record = self.approvals[approval_id]
        if record["status"] != "approved":
            self.audit.append({"type": "execute_denied", "approval_id": approval_id,
                               "at": at, "reason": f"status={record['status']}"})
            raise GateDenied("default_deny",
                             f"status={record['status']}——无批准不执行（G1）")
        if record["payload"] != payload:
            self.audit.append({"type": "execute_denied", "approval_id": approval_id,
                               "at": at, "reason": "payload_drift"})
            raise GateDenied("payload_drift", "载荷与批准时不一致（防调包）")
        record["status"] = "executed"
        self.audit.append({"type": "executed", "approval_id": approval_id, "at": at})
        return {"executed": True, "approval_id": approval_id, "at": at}

    def preview(self, action_kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        """dry-run（§4.2-3）：免费、不改状态、不算投递尝试（G12）。"""
        return {"preview": True, "action_kind": action_kind,
                "registered": action_kind in ACTION_KINDS,
                "payload_keys": sorted(payload)}


class WorkbenchDispatch:
    """唯一出口（§4.2 单点收口）：队列/agent/CLI 均经此触门，不得自行 import。"""

    def __init__(self, gate: DefaultDenyGate, on_executed: Callable[[str, str], None] | None = None):
        self.gate = gate
        self.workbench_events: list[dict[str, Any]] = []  # append-only（§5.2）
        self.approval_refs: dict[str, list[str]] = {}  # task_id → [approval_id]
        self._on_executed = on_executed

    def dispatch_delivery(self, task_id: str, action: str, payload: dict[str, Any],
                          requested_by: str, *, at: str) -> dict[str, Any]:
        """D1–D6 触发点：登记 pending（两段式第一步，不连带执行）。"""
        if action not in DELIVERY_ACTIONS:
            self.workbench_events.append({"type": "bypass_blocked", "task_id": task_id,
                                          "action": action, "at": at})
            raise GateDenied("unregistered_action", f"{action!r} 不在投递动作清单（§4.1）")
        approval = self.gate.request_approval(DELIVERY_ACTIONS[action], payload,
                                              requested_by, at=at)
        self.approval_refs.setdefault(task_id, []).append(approval["approval_id"])
        self.workbench_events.append({"type": "approval_requested", "task_id": task_id,
                                      "approval_id": approval["approval_id"],
                                      "action": action, "at": at})
        return approval

    def execute_approved(self, task_id: str, approval_id: str,
                         payload: dict[str, Any], *, at: str, now: str) -> dict[str, Any]:
        """两段式第二步：仅 approved 经 gate.execute（门内校验为准）。"""
        result = self.gate.execute(approval_id, payload, at=at, now=now)
        self.workbench_events.append({"type": "approval_executed", "task_id": task_id,
                                      "approval_id": approval_id, "at": at})
        if self._on_executed is not None:
            self._on_executed(task_id, approval_id)  # executed 是 to_apply→following 唯一触发
        return result

    def preview(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.gate.preview(DELIVERY_ACTIONS.get(action, action), payload)

    def agent_request_blocked(self, task_id: str, action: str,
                              agent_id: str, *, at: str) -> None:
        """G3：agent 身份调用 requestApproval → 结构性拒绝 + 边界事件。"""
        self.workbench_events.append({"type": "agent_boundary_violation",
                                      "task_id": task_id, "action": action,
                                      "agent": agent_id, "at": at})
        raise GateDenied("agent_boundary_violation",
                         "agent 无权调用门（§3.4 总红线：agent 与投递之间永远隔着两道人工动作）")
