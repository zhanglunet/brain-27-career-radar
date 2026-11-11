# -*- coding: utf-8 -*-
"""PRD-365/T5 测试（trend #1644 的 T5 环节）：投递审批收件箱验收试运行。

运行：python3 -m unittest tests.test_prd365_t5_approval_inbox -v
（仓库根执行）

验收（T1 §5 T5 行「样例回放+文档无密钥」）：
  全链周期演练：三源只读汇聚（待批投递/引用歧义/档案草稿）→ 入箱 →
  人批 → 人拒留痕 → 重复裁决演练（INBOX_DOUBLE_DECIDE 显形）→
  AUTO_EXEC 演练（投递载荷 INBOX_AUTO_EXEC_ATTEMPT 显形拒绝——投递仍
  走 PRD-175 批准门）→ CHOICE_REQUIRED 演练（歧义项 approve 必带候选内
  选择）；两遍全链周期产物逐字节一致（确定性可复现）；账本 append-only；
  零投递行为复验（批/拒返回值零投递载荷键）；链复跑：T2/T3/T4 测试子
  进程复跑 exit 0（链上仍绿实测）；文档无密钥：T1 设计文档拼接 needle
  扫描+占位符纪律（URL 一律 example.invalid）。零网络；全合成占位。
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from approval_inbox import InboxError, InboxLedger, collect  # noqa: E402

NOW = "2026-11-11T09:00:00Z"
FP = "sha16:snap（占位）"
DELIVERY = [{"source_ref": "approval-gate/v1#pending[0]（占位）",
             "fingerprint": FP, "reason": "待批投递（占位）"}]
DISAMB = [{"source_ref": "ref-resolution/v1（占位）", "fingerprint": FP,
           "candidates": ["O-001（占位）", "O-002（占位）"],
           "reason": "歧义候选（占位）"}]
DRAFT = [{"source_ref": "profile-draft#1（占位）", "fingerprint": FP,
          "reason": "草稿确认（占位）"}]


def _fresh_cycle():
    items = collect(delivery_pending=DELIVERY, ref_disambiguations=DISAMB,
                    profile_drafts=DRAFT, at=NOW)
    led = InboxLedger()
    led.add(items)
    led.approve(items[0]["item_id"], by="人（占位）", at=NOW, choice="投")
    led.reject(items[1]["item_id"], by="人（占位）", at=NOW,
               reason="两个都不选（占位）")
    return items, led


class TestFullCycleDrill(unittest.TestCase):
    def test_cycle_deterministic_twice(self):
        """全链周期（收→批→拒）两遍：条目/events/状态逐字节一致。"""
        items1, led1 = _fresh_cycle()
        items2, led2 = _fresh_cycle()
        self.assertEqual(json.dumps(items1, sort_keys=True),
                         json.dumps(items2, sort_keys=True))
        self.assertEqual(json.dumps(led1.events, sort_keys=True),
                         json.dumps(led2.events, sort_keys=True))
        states = [it["state"] for it in led1.view()]
        self.assertEqual(sorted(states), ["approved", "pending",
                                          "rejected"])


class TestFailureDrills(unittest.TestCase):
    def test_double_decide_visible(self):
        """重复裁决演练：INBOX_DOUBLE_DECIDE 显形拒绝。"""
        items, led = _fresh_cycle()
        with self.assertRaisesRegex(InboxError, "INBOX_DOUBLE_DECIDE"):
            led.approve(items[0]["item_id"], by="人（占位）", at=NOW,
                        choice="投")

    def test_auto_exec_payload_rejected(self):
        """AUTO_EXEC 演练：投递载荷 → INBOX_AUTO_EXEC_ATTEMPT 显形拒绝
        （投递动作仍走 PRD-175 批准门由人执行）。"""
        items, led = _fresh_cycle()
        with self.assertRaisesRegex(InboxError, "INBOX_AUTO_EXEC_ATTEMPT"):
            led.approve(items[2]["item_id"], by="人（占位）", at=NOW,
                        payload={"deliver": True}, choice="投")

    def test_choice_required_for_disambiguation(self):
        """CHOICE_REQUIRED 演练：歧义项 approve 缺候选内选择 → 显形拒绝。"""
        items = collect(ref_disambiguations=DISAMB, at=NOW)
        led = InboxLedger()
        led.add(items)
        with self.assertRaisesRegex(InboxError, "INBOX_CHOICE_REQUIRED"):
            led.approve(items[0]["item_id"], by="人（占位）", at=NOW)

    def test_reject_trace_and_zero_delivery_keys(self):
        """拒也留痕；批/拒返回值零投递载荷键（R1 行为复验）。"""
        items, led = _fresh_cycle()
        rejected = next(it for it in led.view()
                        if it["item_id"] == items[1]["item_id"])
        self.assertEqual(rejected["reject_reason"], "两个都不选（占位）")
        fresh = InboxLedger()
        fresh.add(collect(delivery_pending=DELIVERY, at=NOW))
        approved = fresh.approve(items[0]["item_id"], by="人（占位）",
                                 at=NOW, choice="投")
        for key in ("delivered", "submitted"):
            self.assertNotIn(key, approved)

    def test_ledger_append_only_through_drills(self):
        """账本 append-only：全演练流程后 events 只增不删。"""
        _, led1 = _fresh_cycle()
        n0 = len(led1.events)
        items2, led2 = _fresh_cycle()
        try:
            led2.approve(items2[0]["item_id"], by="人（占位）", at=NOW,
                         choice="投")
        except InboxError:
            pass   # 重复裁决被拒——events 不增
        self.assertEqual(len(led2.events), n0)


class TestChainRerun(unittest.TestCase):
    def test_t2_t3_t4_rerun_green(self):
        """链复跑：T2/T3/T4 测试子进程复跑 exit 0（链上仍绿实测）。"""
        repo = Path(__file__).resolve().parents[1]
        for mod in ("tests.test_prd365_t2_approval_inbox",
                    "tests.test_prd365_t3_approval_inbox_gates",
                    "tests.test_prd365_t4_approval_inbox_boundary"):
            proc = subprocess.run(
                [sys.executable, "-m", "unittest", mod],
                capture_output=True, cwd=str(repo), timeout=300)
            self.assertEqual(proc.returncode, 0,
                             f"{mod} 复跑失败：{proc.stderr[-400:]}")


class TestDocNoSecrets(unittest.TestCase):
    def test_t1_design_doc_no_secrets(self):
        """文档无密钥：T1 设计文档拼接 needle 扫描+占位符纪律（URL 一律
        example.invalid）。"""
        repo = Path(__file__).resolve().parents[1]
        doc = next(repo.glob("docs/plans/2026-11-11-prd-365-*.md"))
        text = doc.read_text(encoding="utf-8").lower()
        for needle in ("sk-" + "live", "passw" + "ord", "api_k" + "ey"):
            self.assertNotIn(needle, text, f"设计文档出现密钥词 {needle}")
        self.assertIn("占位", text)


if __name__ == "__main__":
    unittest.main()
