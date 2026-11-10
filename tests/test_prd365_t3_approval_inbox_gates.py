# -*- coding: utf-8 -*-
"""PRD-365/T3 测试（trend #1644 的 T3 环节）：投递批准门收件箱批阅闸门。

运行：python3 -m unittest tests.test_prd365_t3_approval_inbox_gates -v（仓库根执行）

覆盖（T1 §4 + R1/R4）：append_only_gate（无基线形态过/mark_baseline 后追加
pass/删除或首事件改写 LEDGER_DRIFT 显形/非账本对象显形）；state_gate 双向对账
（人批后一致 pass/直接改写/回滚/删除三破坏全部 STATE_INCONSISTENT 显形）；
gate_summary 一票否决；与 T2 串联（真实 add/approve/reject+CHOICE_REQUIRED
产物过闸全 pass）；AST 零投递零网络+闸门只读。零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from approval_inbox import ERROR_CODES as T2_ERROR_CODES  # noqa: E402
from approval_inbox import InboxLedger, collect  # noqa: E402
from approval_inbox_gates import (  # noqa: E402
    GATE_CODES,
    append_only_gate,
    gate_summary,
    mark_baseline,
    state_gate,
)

NOW = "2026-11-11T09:00:00Z"
FP = "sha16:snap（占位）"
DELIVERY = [{"source_ref": "approval-gate/v1#pending[0]（占位）",
             "fingerprint": FP, "reason": "待批投递（占位）"}]
DISAMb = [{"source_ref": "ref-resolution/v1（占位）", "fingerprint": FP,
           "candidates": ["O-001（占位）", "O-002（占位）"],
           "reason": "歧义候选（占位）"}]
DRAFT = [{"source_ref": "profile-draft#1（占位）", "fingerprint": FP,
          "reason": "草稿确认（占位）"}]


class TestAppendOnlyGate(unittest.TestCase):
    def setUp(self):
        self.led = InboxLedger()
        self.led.add(collect(delivery_pending=DELIVERY,
                             ref_disambiguations=DISAMb, profile_drafts=DRAFT,
                             at=NOW))
        self.led.approve("item-001", by="j（占位）", at=NOW,
                         choice="O-001（占位）")

    def test_no_baseline_form_check_passes(self):
        self.assertEqual(append_only_gate(self.led)["gate"], "pass")

    def test_mark_baseline_then_append_passes(self):
        mark_baseline(self.led)
        self.led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        self.assertEqual(append_only_gate(self.led)["gate"], "pass")

    def test_deletion_detected(self):
        mark_baseline(self.led)
        self.led._events.pop()
        self.assertEqual(append_only_gate(self.led)["gate"], "LEDGER_DRIFT")

    def test_first_event_rewrite_detected(self):
        mark_baseline(self.led)
        self.led._events[0]["op"] = "deleted（篡改）（占位）"
        self.assertEqual(append_only_gate(self.led)["gate"], "LEDGER_DRIFT")

    def test_non_ledger_object_visible(self):
        self.assertEqual(append_only_gate(object())["gate"], "LEDGER_DRIFT")


class TestStateGate(unittest.TestCase):
    def setUp(self):
        self.led = InboxLedger()
        self.led.add(collect(delivery_pending=DELIVERY,
                             ref_disambiguations=DISAMb, profile_drafts=DRAFT,
                             at=NOW))
        self.led.approve("item-001", by="j（占位）", at=NOW,
                         choice="O-001（占位）")

    def test_consistent_state_passes(self):
        self.assertEqual(state_gate(self.led)["gate"], "pass")

    def test_direct_item_rewrite_detected(self):
        """条目被直接改写（未经 _decide）→ STATE_INCONSISTENT。"""
        self.led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        self.led._items["item-003"]["state"] = "pending"
        out = state_gate(self.led)
        self.assertEqual(out["gate"], "STATE_INCONSISTENT")
        self.assertTrue(any("item-003" in r for r in out["reasons"]))

    def test_state_rollback_detected(self):
        self.led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        self.led._items["item-003"]["state"] = "pending"
        self.assertEqual(state_gate(self.led)["gate"], "STATE_INCONSISTENT")

    def test_item_deleted_detected(self):
        self.led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        del self.led._items["item-003"]
        out = state_gate(self.led)
        self.assertEqual(out["gate"], "STATE_INCONSISTENT")
        self.assertTrue(any("条目被删除" in r for r in out["reasons"]))


class TestSummaryAndChain(unittest.TestCase):
    def test_summary_one_block_votes_all(self):
        led = InboxLedger()
        led.add(collect(delivery_pending=DELIVERY, at=NOW))
        led.approve("item-001", by="j（占位）", at=NOW)
        led._items["item-001"]["state"] = "pending"
        out = gate_summary([append_only_gate(led), state_gate(led)])
        self.assertEqual(out["gate"], "block")
        self.assertEqual(out["gates_checked"], 2)

    def test_chain_with_real_t2_products(self):
        """与 T2 串联：真实 add/approve(CHOICE)/reject 产物过闸全 pass。"""
        led = InboxLedger()
        led.add(collect(delivery_pending=DELIVERY,
                        ref_disambiguations=DISAMb, profile_drafts=DRAFT,
                        at=NOW))
        led.approve("item-001", by="j（占位）", at=NOW)
        led.approve("item-002", by="j（占位）", at=NOW,
                    choice="O-001（占位）")
        led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        mark_baseline(led)
        results = [append_only_gate(led), state_gate(led)]
        self.assertTrue(all(r["gate"] == "pass" for r in results))
        self.assertEqual(gate_summary(results)["gate"], "pass")

    def test_gate_codes_closed_and_distinct_from_t2(self):
        """T3 三码与 T2 四码并列封闭（各自守各自层）。"""
        self.assertEqual(set(GATE_CODES),
                         {"LEDGER_DRIFT", "STATE_INCONSISTENT",
                          "DECISION_MISSING"})
        self.assertEqual(set(T2_ERROR_CODES),
                         {"INBOX_ITEM_INCOMPLETE", "INBOX_DOUBLE_DECIDE",
                          "INBOX_AUTO_EXEC_ATTEMPT", "INBOX_CHOICE_REQUIRED"})


class TestRedline(unittest.TestCase):
    def test_ast_zero_delivery_zero_network_readonly(self):
        """R1 AST：投递零自动（与 337/T4 351/T2 同表）+闸门只读（零裁决
        调用）。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "smtp", "delivery", "apply"}
        src = (REPO / "lib" / "approval_inbox_gates.py").read_text(
            encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)
        for call in (".add(", ".approve(", ".reject("):
            self.assertNotIn(call, src, f"闸门出现裁决调用 {call}")


if __name__ == "__main__":
    unittest.main()
