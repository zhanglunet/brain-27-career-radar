# -*- coding: utf-8 -*-
"""PRD-365/T2 测试（trend #1644 的 T2 环节）：投递批准门收件箱。

运行：python3 -m unittest tests.test_prd365_t2_approval_inbox -v（仓库根执行）

覆盖（T1 §3.1/§3.2/§4 + R1–R4）：collect 三源只读汇聚（词表封闭+四件套缺一
INBOX_ITEM_INCOMPLETE 显形拒绝入箱+fingerprint 与 PRD-351 snapshot_digest
同源）；InboxLedger 状态机（approve/reject 人批留痕/重复裁决/未知 id/AUTO_EXEC
携带投递载荷拒绝——零投递触发 R1 走 175 门/歧义项 approve 必带选中候选
CHOICE_REQUIRED 且候选须在列表内 §6.1）；append-only；view kind 过滤；AST
零投递零网络。零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from approval_inbox import (  # noqa: E402
    ERROR_CODES,
    ITEM_KINDS,
    InboxError,
    InboxLedger,
    collect,
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


class TestCollect(unittest.TestCase):
    def test_three_sources_closed_vocab(self):
        items = collect(delivery_pending=DELIVERY,
                        ref_disambiguations=DISAMb, profile_drafts=DRAFT,
                        at=NOW)
        self.assertEqual([it["kind"] for it in items],
                         ["delivery_approval", "ref_disambiguation",
                          "profile_draft_confirm"])
        self.assertEqual(set(ITEM_KINDS),
                         {"delivery_approval", "ref_disambiguation",
                          "profile_draft_confirm"})

    def test_fingerprint_same_source_as_351(self):
        """R3：fingerprint 与 PRD-351 snapshot_digest 同源（调用方注入）。"""
        items = collect(delivery_pending=DELIVERY, at=NOW)
        self.assertEqual(items[0]["fingerprint"], FP)

    def test_incomplete_raises_visible(self):
        """R3：reason 缺失 → INBOX_ITEM_INCOMPLETE 显形拒绝入箱。"""
        with self.assertRaisesRegex(InboxError, "INBOX_ITEM_INCOMPLETE"):
            collect(delivery_pending=[{"source_ref": "s"}], at=NOW)


class TestLedger(unittest.TestCase):
    def _ledger(self):
        led = InboxLedger()
        led.add(collect(delivery_pending=DELIVERY,
                        ref_disambiguations=DISAMb, profile_drafts=DRAFT,
                        at=NOW))
        return led

    def test_approve_reject_state_machine(self):
        led = self._ledger()
        a = led.approve("item-001", by="jobseeker（占位）", at=NOW)
        self.assertEqual(a["state"], "approved")
        c = led.approve("item-002", by="jobseeker（占位）", at=NOW,
                        choice="O-001（占位）")
        self.assertEqual(c["chosen_candidate"], "O-001（占位）")
        r = led.reject("item-003", by="jobseeker（占位）", at=NOW,
                       reason="暂不改（占位）")
        self.assertEqual(r["state"], "rejected")

    def test_choice_required_and_candidate_validated(self):
        """§6.1：歧义项 approve 必带选中候选；候选须在列表内。"""
        led = self._ledger()
        with self.assertRaisesRegex(InboxError, "INBOX_CHOICE_REQUIRED"):
            led.approve("item-002", by="j（占位）", at=NOW)
        with self.assertRaisesRegex(InboxError, "INBOX_CHOICE_REQUIRED"):
            led.approve("item-002", by="j（占位）", at=NOW,
                        choice="O-999（不在列表）（占位）")
        a = led.approve("item-002", by="j（占位）", at=NOW,
                        choice="O-001（占位）")
        self.assertEqual(a["chosen_candidate"], "O-001（占位）")

    def test_double_and_unknown_visible(self):
        led = self._ledger()
        led.approve("item-001", by="j（占位）", at=NOW)
        with self.assertRaisesRegex(InboxError, "INBOX_DOUBLE_DECIDE"):
            led.reject("item-001", by="j（占位）", at=NOW)
        with self.assertRaisesRegex(InboxError, "未知"):
            led.approve("item-999", by="j（占位）", at=NOW)

    def test_auto_exec_delivery_payload_rejected(self):
        """R1：裁决携带投递载荷 → AUTO_EXEC 显形拒绝（零投递触发）。"""
        led = self._ledger()
        with self.assertRaisesRegex(InboxError, "INBOX_AUTO_EXEC_ATTEMPT"):
            led.approve("item-001", by="j（占位）", at=NOW,
                        payload={"deliver": "O-001（占位）"})
        with self.assertRaisesRegex(InboxError, "INBOX_AUTO_EXEC_ATTEMPT"):
            led.reject("item-001", by="j（占位）", at=NOW,
                       payload={"submit": True})
        self.assertEqual(led.view()[0]["state"], "pending")   # 零状态变化

    def test_append_only_and_view_filter(self):
        led = self._ledger()
        led.approve("item-001", by="j（占位）", at=NOW)
        before = [dict(e) for e in led.events]
        led.reject("item-003", by="j（占位）", at=NOW, reason="r（占位）")
        self.assertEqual(led.events[:len(before)], before)
        self.assertEqual(len(led.events), len(before) + 1)
        self.assertEqual(len(led.view("ref_disambiguation")), 1)
        self.assertEqual(len(led.view()), 3)


class TestRedline(unittest.TestCase):
    def test_error_codes_closed(self):
        self.assertEqual(set(ERROR_CODES),
                         {"INBOX_ITEM_INCOMPLETE", "INBOX_DOUBLE_DECIDE",
                          "INBOX_AUTO_EXEC_ATTEMPT", "INBOX_CHOICE_REQUIRED"})

    def test_ast_zero_delivery_zero_network(self):
        """R1 AST：投递零自动——零投递导入（与 337/T4 351/T2 同表）。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "smtp", "delivery", "apply"}
        tree = ast.parse((REPO / "lib" / "approval_inbox.py").read_text(
            encoding="utf-8"))
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)


if __name__ == "__main__":
    unittest.main()
