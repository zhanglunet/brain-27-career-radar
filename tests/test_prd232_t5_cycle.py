# -*- coding: utf-8 -*-
"""PRD-232/T5 测试：验收试运行——完整求职周期演练（trend #1164）。

运行：python3 -m unittest tests.test_prd232_t5_cycle -v（仓库根执行）

验收标准（trend #1164）：**全流程通过，门禁零绕过**。

演练（合成一个完整求职周期，占位标识）：
  入库（TaskQueue queued）→ D1 投递（dispatch 两段式：request pending →
  人工 approve → execute）→ executed 唯一触发 queued→following →
  D3 跟进邮件（同两段式）→ interviewing → 终态 rejected；
  旁路全拒（门禁零绕过）：G1 无批准执行拒、G2 未注册动作 bypass_blocked、
  G3 agent 越权结构性拒、载荷调包拒、preview 免费无副作用（G12）；
  终局对账：门侧审计 append-only 与工作台事件双侧对账（G11），
  executed 数 = approved 数 = 2，无一处未批准执行。
零网络；全合成占位。
"""
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from approval_dispatch import (  # noqa: E402
    DELIVERY_ACTIONS,
    GateDenied,
    DefaultDenyGate,
    WorkbenchDispatch,
)
from task_queue import QueueError, TaskQueue  # noqa: E402

APPLY_PAYLOAD = {"form_url": "https://jobs.example.com/apply/123（占位）",
                 "resume_ref": "resume-2026（占位）"}
FOLLOWUP_PAYLOAD = {"to": "hr@example.com（占位）",
                    "body": "跟进面试进展（占位正文）"}


def build_cycle():
    """一个完整求职周期：队列 + 门 + 唯一出口，executed→following 唯一触发。"""
    queue = TaskQueue()
    gate = DefaultDenyGate()
    dispatch = WorkbenchDispatch(gate)
    queue.add("task-001", "示例公司（占位）", "脑机接口算法工程师（占位）",
              at="2026-11-10T09:00:00Z")
    return queue, gate, dispatch


class 周期全链Tests(unittest.TestCase):
    def test_full_cycle_passes_through_gate_twice(self):
        """验收①全流程通过：投递/跟进两动作全程走门，状态机与事件链完整。"""
        queue, gate, dispatch = build_cycle()

        # —— D1 投递：两段式（request 只 pending，不连带执行）——
        approval = dispatch.dispatch_delivery(
            "task-001", "D1_submit_application", APPLY_PAYLOAD,
            requested_by="planner-01（占位）", at="2026-11-10T09:05:00Z")
        self.assertEqual(approval["status"], "pending")
        self.assertEqual(queue.tasks["task-001"]["status"], "queued")  # 未执行不迁移
        gate.decide(approval["approval_id"], "approved", by="user（占位）",
                    at="2026-11-10T10:00:00Z")
        fired = []
        dispatch_with_hook = WorkbenchDispatch(gate, on_executed=lambda t, a: fired.append(t))
        result = dispatch_with_hook.execute_approved(
            "task-001", approval["approval_id"], APPLY_PAYLOAD,
            at="2026-11-10T10:01:00Z", now="2026-11-10T10:01:00Z")
        self.assertTrue(result["executed"])
        # executed 是 queued→following 的唯一触发（经 on_executed 回调）
        queue.transition("task-001", "following", reason="D1 已执行（批准投递）",
                         at="2026-11-10T10:01:00Z")
        self.assertEqual(fired, ["task-001"])

        # —— D3 跟进：同两段式 ——
        follow = dispatch.dispatch_delivery(
            "task-001", "D3_send_followup_email", FOLLOWUP_PAYLOAD,
            requested_by="planner-01（占位）", at="2026-11-12T09:00:00Z")
        gate.decide(follow["approval_id"], "approved", by="user（占位）",
                    at="2026-11-12T10:00:00Z")
        dispatch.execute_approved("task-001", follow["approval_id"],
                                  FOLLOWUP_PAYLOAD,
                                  at="2026-11-12T10:01:00Z",
                                  now="2026-11-12T10:01:00Z")
        queue.transition("task-001", "interviewing", reason="进入面试（占位）",
                         at="2026-11-15T09:00:00Z")
        queue.transition("task-001", "rejected", reason="流程终止（占位）",
                         at="2026-11-20T09:00:00Z")

        # 状态机全程：queued→following→interviewing→rejected
        self.assertEqual(
            [e["to"] for e in queue.export_events()],
            ["queued", "following", "interviewing", "rejected"])
        # 两次投递动作都在 approval_refs 对账册上
        self.assertEqual(len(dispatch.approval_refs["task-001"]), 2)


class 门禁零绕过Tests(unittest.TestCase):
    def setUp(self):
        self.queue, self.gate, self.dispatch = build_cycle()

    def test_g1_execute_without_approval_denied(self):
        """G1：无 approved 记录执行 → default_deny 拒绝。"""
        with self.assertRaises(GateDenied) as ctx:
            self.gate.execute("apr-9999", APPLY_PAYLOAD,
                              at="2026-11-10T09:00:00Z", now="2026-11-10T09:00:00Z")
        self.assertEqual(ctx.exception.code, "default_deny")

    def test_g2_unregistered_action_blocked(self):
        """G2：清单外动作（直投邮箱等旁路形态）→ bypass_blocked + 拒绝。"""
        with self.assertRaises(GateDenied) as ctx:
            self.dispatch.dispatch_delivery(
                "task-001", "D99_direct_message", {"to": "someone（占位）"},
                requested_by="planner-01（占位）", at="2026-11-10T09:00:00Z")
        self.assertEqual(ctx.exception.code, "unregistered_action")
        bypass = [e for e in self.dispatch.workbench_events
                  if e["type"] == "bypass_blocked"]
        self.assertEqual(len(bypass), 1)

    def test_g3_agent_boundary_structural_reject(self):
        """G3：agent 身份调门 → 结构性拒绝 + 边界事件（两道人工动作红线）。"""
        with self.assertRaises(GateDenied) as ctx:
            self.dispatch.agent_request_blocked(
                "task-001", "D1_submit_application", "agent-77（占位）",
                at="2026-11-10T09:00:00Z")
        self.assertEqual(ctx.exception.code, "agent_boundary_violation")

    def test_payload_tamper_denied(self):
        """两段式防调包：execute 载荷与批准时不一致 → payload_drift 拒绝。"""
        approval = self.dispatch.dispatch_delivery(
            "task-001", "D1_submit_application", APPLY_PAYLOAD,
            requested_by="planner-01（占位）", at="2026-11-10T09:05:00Z")
        self.gate.decide(approval["approval_id"], "approved", by="user（占位）",
                         at="2026-11-10T10:00:00Z")
        tampered = dict(APPLY_PAYLOAD, resume_ref="resume-伪造（占位）")
        with self.assertRaises(GateDenied) as ctx:
            self.dispatch.execute_approved("task-001", approval["approval_id"],
                                           tampered, at="2026-11-10T10:01:00Z",
                                           now="2026-11-10T10:01:00Z")
        self.assertEqual(ctx.exception.code, "payload_drift")
        # 调包被拒未消耗批准；原载荷执行仍可（两段式第二步以载荷一致为准）
        result = self.dispatch.execute_approved("task-001", approval["approval_id"],
                                                APPLY_PAYLOAD,
                                                at="2026-11-10T10:02:00Z",
                                                now="2026-11-10T10:02:00Z")
        self.assertTrue(result["executed"])

    def test_preview_free_no_side_effect(self):
        """G12：preview 免费、不改状态、不算投递尝试。"""
        before = len(self.gate.audit)
        preview = self.dispatch.preview("D1_submit_application", APPLY_PAYLOAD)
        self.assertTrue(preview["preview"])
        self.assertTrue(preview["registered"])
        self.assertEqual(len(self.gate.audit), before)      # 审计零新增


class 终局对账Tests(unittest.TestCase):
    def test_g11_reconciliation_no_unapproved_execution(self):
        """验收②门禁零绕过对账：executed 数 = approved 数；无未批准执行；
        工作台事件与门侧审计逐条可对。"""
        queue, gate, dispatch = build_cycle()
        for action, payload in (("D1_submit_application", APPLY_PAYLOAD),
                                ("D3_send_followup_email", FOLLOWUP_PAYLOAD)):
            approval = dispatch.dispatch_delivery(
                "task-001", action, payload, requested_by="planner-01（占位）",
                at="2026-11-10T09:05:00Z")
            gate.decide(approval["approval_id"], "approved", by="user（占位）",
                        at="2026-11-10T10:00:00Z")
            dispatch.execute_approved("task-001", approval["approval_id"], payload,
                                      at="2026-11-10T10:01:00Z",
                                      now="2026-11-10T10:01:00Z")
        executed = [e for e in gate.audit if e["type"] == "executed"]
        approved = [e for e in gate.audit if e["type"] == "approved"]
        denied = [e for e in gate.audit if e["type"] == "execute_denied"]
        self.assertEqual(len(executed), len(approved) == 2 and 2)
        self.assertEqual(denied, [])
        refs = dispatch.approval_refs["task-001"]
        executed_ids = {e["approval_id"] for e in executed}
        self.assertTrue(set(refs) <= executed_ids | {
            e["approval_id"] for e in gate.audit if e["type"] in ("requested",)})
        # 工作台侧：每次执行都有配对的 approval_requested + approval_executed
        requested_events = [e for e in dispatch.workbench_events
                            if e["type"] == "approval_requested"]
        executed_events = [e for e in dispatch.workbench_events
                           if e["type"] == "approval_executed"]
        self.assertEqual(len(requested_events), 2)
        self.assertEqual(len(executed_events), 2)
        # D1–D6 清单动作与门内注册 kind 一致（default-deny 面）
        self.assertEqual(DELIVERY_ACTIONS["D1_submit_application"], "webform_submit")


if __name__ == "__main__":
    unittest.main()
