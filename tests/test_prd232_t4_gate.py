# -*- coding: utf-8 -*-
"""PRD-232/T4 测试（trend #1163）：批准门衔接——投递动作强制走 PRD-175 门。

覆盖（T1 §4）：投递动作清单 default-deny（D1–D6 映射/清单外拒绝）、两段式
（request 只 pending、execute 需 approved 且载荷一致）、G1 无批准执行拒、
G2 未注册 action_kind + bypass_blocked、G3 agent 越权 + 边界事件、G11 双侧
对账、G12 preview 无副作用、单点收口（静态 import 图断言）。零网络；全占位。
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from approval_dispatch import (  # noqa: E402
    ACTION_KINDS,
    DELIVERY_ACTIONS,
    DefaultDenyGate,
    GateDenied,
    WorkbenchDispatch,
)

PAYLOAD = {"form_url": "https://example.placeholder/apply", "fields": {"k": "v（占位）"}}
T0 = "2026-11-08T10:00:00Z"


class 投递动作清单Tests(unittest.TestCase):
    def test_six_delivery_actions_mapped(self):
        """§4.1：D1–D6 全部映射到已注册 action_kind；D3 跟进邮件明确在列。"""
        assert len(DELIVERY_ACTIONS) == 6
        assert DELIVERY_ACTIONS["D3_send_followup_email"] == "email_send"
        assert set(DELIVERY_ACTIONS.values()) <= set(ACTION_KINDS)

    def test_unlisted_action_rejected(self):
        """清单外动作一律不存在（default-deny；本地草稿等不过门）。"""
        dispatch = WorkbenchDispatch(DefaultDenyGate())
        with self.assertRaises(GateDenied, msg="不在投递动作清单"):
            dispatch.dispatch_delivery("task-1", "local_draft_edit", {},
                                       "user:x-placeholder", at=T0)


class 两段式Tests(unittest.TestCase):
    def setUp(self):
        self.gate = DefaultDenyGate()
        self.dispatch = WorkbenchDispatch(self.gate)

    def test_request_only_creates_pending(self):
        """两段式：request 只产生 pending，不连带执行。"""
        approval = self.dispatch.dispatch_delivery("task-1", "D1_submit_application",
                                                   PAYLOAD, "user:x", at=T0)
        self.assertEqual(approval["status"], "pending")
        self.assertFalse(self.gate.approvals[approval["approval_id"]]["status"]
                         == "executed")

    def test_execute_without_approval_denied(self):
        """G1：无 approved 记录时执行 → default-deny 拒绝，无任何发送。"""
        with self.assertRaises(GateDenied, msg="default_deny"):
            self.dispatch.execute_approved("task-1", "apr-9999", PAYLOAD,
                                           at=T0, now=T0)
        executed = [a for a in self.gate.audit if a["type"] == "executed"]
        self.assertEqual(executed, [])

    def test_execute_after_approval_ok_and_reconcilable(self):
        """G11 双侧对账：executed 后 approval_id 在门审计与工作台事件互查。"""
        approval = self.dispatch.dispatch_delivery("task-1", "D1_submit_application",
                                                   PAYLOAD, "user:x", at=T0)
        self.gate.decide(approval["approval_id"], "approved", "user:x", at=T0)
        self.dispatch.execute_approved("task-1", approval["approval_id"], PAYLOAD,
                                       at=T0, now=T0)
        executed = [a for a in self.gate.audit if a["type"] == "executed"]
        assert_ids = [e["approval_id"] for e in self.dispatch.workbench_events
                      if e["type"] == "approval_executed"]
        self.assertEqual([e["approval_id"] for e in executed], assert_ids)

    def test_payload_drift_rejected(self):
        """门内校验：载荷与批准时不一致（防调包）→ 拒绝。"""
        approval = self.dispatch.dispatch_delivery("task-1", "D1_submit_application",
                                                   PAYLOAD, "user:x", at=T0)
        self.gate.decide(approval["approval_id"], "approved", "user:x", at=T0)
        drift = json.loads(json.dumps(PAYLOAD))
        drift["fields"]["k"] = "调包后（占位）"
        with self.assertRaises(GateDenied, msg="payload_drift"):
            self.dispatch.execute_approved("task-1", approval["approval_id"], drift,
                                           at=T0, now=T0)


class 门禁用例Tests(unittest.TestCase):
    def test_g2_unregistered_action_kind(self):
        """G2：未注册 action_kind → 门侧 bypass_blocked 审计。"""
        gate = DefaultDenyGate()
        with self.assertRaises(GateDenied):
            gate.request_approval("nonexistent_kind", {}, "user:x", at=T0)
        assert any(a["type"] == "bypass_blocked" for a in gate.audit)

    def test_g3_agent_boundary(self):
        """G3：agent 调 requestApproval → 结构性拒绝 + 边界事件。"""
        gate = DefaultDenyGate()
        with self.assertRaises(GateDenied, msg="agent_boundary_violation"):
            gate.request_approval("email_send", {}, "agent:pi-placeholder", at=T0)
        assert any(a["type"] == "agent_boundary_violation" for a in gate.audit)
        dispatch = WorkbenchDispatch(gate)
        with self.assertRaises(GateDenied, msg="agent 无权调用门"):
            dispatch.agent_request_blocked("task-1", "D1_submit_application",
                                           "agent:pi-placeholder", at=T0)
        assert any(e["type"] == "agent_boundary_violation"
                   for e in dispatch.workbench_events)

    def test_g12_preview_no_side_effects(self):
        """G12：preview 反复调用不改状态、不算投递尝试。"""
        gate = DefaultDenyGate()
        dispatch = WorkbenchDispatch(gate)
        for _ in range(3):
            dispatch.preview("D1_submit_application", PAYLOAD)
        self.assertEqual(len(gate.audit), 0)  # 审计无新增
        self.assertEqual(gate.approvals, {})  # 无 pending 产生

    def test_resubmit_is_fresh_request(self):
        """D6：重新投递 = 全新请求 + 全新批准，不复活旧记录。"""
        gate = DefaultDenyGate()
        dispatch = WorkbenchDispatch(gate)
        first = dispatch.dispatch_delivery("task-1", "D1_submit_application",
                                           PAYLOAD, "user:x", at=T0)
        gate.decide(first["approval_id"], "rejected", "user:x", at=T0)
        second = dispatch.dispatch_delivery("task-2", "D1_submit_application",
                                            PAYLOAD, "user:x", at=T0)
        self.assertNotEqual(first["approval_id"], second["approval_id"])
        self.assertEqual(second["status"], "pending")  # 不复活旧记录


class 单点收口Tests(unittest.TestCase):
    def test_import_graph_single_gate_module(self):
        """G10（python 形态）：本仓 lib/ 下仅 approval_dispatch 引用门接口词。"""
        lib_dir = Path(__file__).resolve().parents[1] / "lib"
        gate_terms = ("requestApproval", "gate.execute", "approval/gate.ts")
        offenders = []
        for py in lib_dir.glob("*.py"):
            if py.name == "approval_dispatch.py":
                continue
            text = py.read_text(encoding="utf-8")
            for term in gate_terms:
                if term in text:
                    offenders.append((py.name, term))
        self.assertEqual(offenders, [], f"非出口模块引用门接口：{offenders}")


if __name__ == "__main__":
    unittest.main()
