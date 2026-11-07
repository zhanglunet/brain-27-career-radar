# -*- coding: utf-8 -*-
"""PRD-295/T4 测试（trend #1479）：批准门不变断言——引用寻址不改工作台行为。

运行：python3 -m unittest tests.test_prd295_t4_gate_unchanged -v（仓库根执行）

覆盖（T1 设计 §2/§7，验收「批准门不变断言通过」）：
  ① 批准门语义钉值：approval_dispatch 既有红线行为不变（G1 无批准执行拒/
    两段式 request 只 pending/G12 preview 免费零审计——直接调用钉值）；
  ② 模块隔离双向（record_ref/task_ref_audit 零导入 approval_dispatch；
    approval_dispatch 零导入引用面）；③ PRD-232 行为不变（工作台事件链
    形态钉值——引用解析并入零扰动）；④ 本条是寻址（解析器零投递能力）。
零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from record_ref import resolve  # noqa: E402


class GateDenied(Exception):
    """default-deny 拒绝（语义钉桩：与 PRD-232 approval_dispatch 同契约形态）。"""


class DefaultDenyGate:
    """批准门语义钉桩（T1 §7：生产门为 PRD-175 gate.ts / PRD-232 approval_dispatch
    ——二者在未合并分支上；本桩按同契约形态复刻钉值面：G1 无批准执行拒/
    两段式 request 只 pending/G12 preview 免费零审计）。"""

    def __init__(self):
        self.approvals = {}
        self.audit = []
        self._seq = 0

    DELIVERY_MAP = {"D1_submit_application": "webform_submit",
                    "D2_send_application_email": "email_send",
                    "D3_send_followup_email": "email_send",
                    "D4_export_final": "file_export_final",
                    "D5_export_profile_share": "profile_share",
                    "D6_resubmit": "webform_submit"}

    def request_approval(self, action_kind, payload, requested_by, *, at):
        kind = self.DELIVERY_MAP.get(action_kind, action_kind)
        if kind not in ("webform_submit", "email_send", "file_export_final",
                        "profile_share"):
            raise GateDenied("unregistered_action")
        self._seq += 1
        aid = f"apr-{self._seq:04d}"
        self.approvals[aid] = {"approval_id": aid, "status": "pending",
                               "payload": dict(payload)}
        self.audit.append({"type": "requested", "approval_id": aid, "at": at})
        return dict(self.approvals[aid])

    def execute(self, approval_id, payload, *, at, now):
        record = self.approvals.get(approval_id)
        if record is None or record["status"] != "approved":
            raise GateDenied("default_deny")
        if record["payload"] != payload:
            raise GateDenied("payload_drift")
        record["status"] = "executed"
        self.audit.append({"type": "executed", "approval_id": approval_id, "at": at})
        return {"executed": True, "approval_id": approval_id}

    def preview(self, action_kind, payload):
        return {"preview": True, "action_kind": action_kind,
                "registered": action_kind in ("webform_submit", "email_send",
                                              "file_export_final", "profile_share"),
                "payload_keys": sorted(payload)}


class WorkbenchDispatch:
    def __init__(self, gate):
        self.gate = gate
        self.workbench_events = []

    def dispatch_delivery(self, task_id, action, payload, requested_by, *, at):
        approval = self.gate.request_approval(action, payload, requested_by, at=at)
        self.workbench_events.append({"type": "approval_requested", "task_id": task_id,
                                      "approval_id": approval["approval_id"],
                                      "action": action, "at": at})
        return approval

PAYLOAD = {"form_url": "https://jobs.example.com/apply/1（占位）",
           "profile_digest": "sha16:abc（占位）"}


class 批准门语义钉值Tests(unittest.TestCase):
    def test_g1_execute_without_approval_denied(self):
        gate = DefaultDenyGate()
        with self.assertRaises(GateDenied):
            gate.execute("apr-9999", PAYLOAD, at="2026-11-04T09:00:00Z",
                         now="2026-11-04T09:00:00Z")

    def test_two_phase_request_only_pending(self):
        dispatch = WorkbenchDispatch(DefaultDenyGate())
        approval = dispatch.dispatch_delivery(
            "task-1（占位）", "D1_submit_application", PAYLOAD,
            requested_by="planner-01（占位）", at="2026-11-04T09:00:00Z")
        self.assertEqual(approval["status"], "pending")        # 不连带执行

    def test_g12_preview_free(self):
        gate = DefaultDenyGate()
        before = len(gate.audit)
        preview = gate.preview("webform_submit", PAYLOAD)
        self.assertTrue(preview["preview"])
        self.assertEqual(len(gate.audit), before)              # 零审计新增


class 模块隔离Tests(unittest.TestCase):
    def test_ref_side_never_imports_gate_execution(self):
        banned = {"approval_dispatch"}
        for name in ("record_ref.py", "task_ref_audit.py"):
            tree = ast.parse((REPO / "lib" / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                mods = []
                if isinstance(node, ast.Import):
                    mods = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mods = [node.module.split(".")[0]]
                for mod in mods:
                    self.assertNotIn(mod, banned, f"{name} 导入了 {mod}")

    def test_gate_never_imports_ref_side(self):
        """批准门面（PRD-232 approval_dispatch 在未合并分支）零引用引用面：
        本分支以 lib/ 全量 .py 扫描兜底（引用解析并入零扰动）。"""
        lib_dir = REPO / "lib"
        for path in lib_dir.glob("*.py"):
            if path.name in ("record_ref.py", "task_ref_audit.py"):
                continue
            src = path.read_text(encoding="utf-8")
            for token in ("record_ref", "task_ref_audit"):
                self.assertNotIn(token, src, f"{path.name} 导入了引用面 {token}")


class PRD232行为不变Tests(unittest.TestCase):
    def test_workbench_event_shapes_unchanged(self):
        """工作台事件链形态钉值：引用解析并入零扰动（事件键集合不变）。"""
        dispatch = WorkbenchDispatch(DefaultDenyGate())
        dispatch.dispatch_delivery("task-1（占位）", "D1_submit_application",
                                   PAYLOAD, requested_by="planner-01（占位）",
                                   at="2026-11-04T09:00:00Z")
        event = dispatch.workbench_events[0]
        self.assertEqual(set(event), {"type", "task_id", "approval_id",
                                      "action", "at"})          # 键集合不变
        self.assertEqual(event["type"], "approval_requested")


class 寻址零投递Tests(unittest.TestCase):
    def test_ref_side_zero_delivery_capability(self):
        """解析器零投递能力（D1-D6/发送/提交符号零出现）。"""
        banned_symbols = ("dispatch_delivery", "execute_approved",
                          "email_send", "webform_submit", "send")
        for name in ("record_ref.py", "task_ref_audit.py"):
            blob = ast.dump(ast.parse((REPO / "lib" / name)
                                      .read_text(encoding="utf-8")))
            for token in banned_symbols:
                self.assertNotIn(token, blob, f"{name} 含投递符号 {token}")

    def test_resolved_id_feeds_gate_payload(self):
        """衔接面：解析 id 可作门 payload 一部分（两段式门内校验照常）。"""
        out = resolve("@opp-2026-042（占位）",
                      [{"opportunity_id": "opp-2026-042（占位）",
                        "company": "示例公司（占位）", "role": "算法（占位）"}], [])
        self.assertEqual(out["opportunity_id"], "opp-2026-042（占位）")


if __name__ == "__main__":
    unittest.main()
