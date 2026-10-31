# -*- coding: utf-8 -*-
"""PRD-203/T4 自测（trend #1018）：截止日期与硬性要求显式标注。

运行：python3 -m unittest tests.test_prd203_t4_flags -v（仓库根执行）

覆盖（验收「不符合用户条件的机会被标出而非静默混入」）：
  PhD 要求 vs 用户未声明博士 → mismatch=True 显式标出
  在读证明要求 vs 用户声明不能提供 → mismatch=True
  用户未声明该项条件 → mismatch=None（无法判定，不武断标红）
  截止日期已过 → expired=True；未过 → False
  排序：符合在前，不符/过期显式靠后
  深读无硬性要求 → 不产 false 标注

虚构纪律：全合成；零网络。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from requirement_flags import flag_requirements, sort_by_fit  # noqa: E402

NOW = "2026-11-01T00:00:00+00:00"


def opp(oid, *, phd=None, enroll=None, deadline=None, deep=True):
    fields = {}
    if phd is not None:
        fields["phd_required"] = {"value": phd, "extract_status": "ok"}
    if enroll is not None:
        fields["enrollment_required"] = {"value": enroll, "extract_status": "ok"}
    if deadline is not None:
        fields["deadline"] = {"value": deadline, "extract_status": "ok",
                              "evidence": {"url": "https://x.example.edu/1"}}
    entry = {"opportunity_id": oid}
    if deep:
        entry["deep_read"] = {"status": "ok", "fields": fields}
    return entry


class FlagTests(unittest.TestCase):
    def test_phd_mismatch_flagged(self):
        rows = flag_requirements([opp("o1", phd=True)],
                                 {"phd": False}, now=NOW)
        req = rows[0]["requirements"]
        self.assertTrue(req["mismatched"])                     # 显式标出
        self.assertEqual(req["flags"][0]["field"], "phd_required")

    def test_enrollment_mismatch_flagged(self):
        rows = flag_requirements([opp("o1", enroll=True)],
                                 {"enrollment_proof_ok": False}, now=NOW)
        self.assertTrue(rows[0]["requirements"]["mismatched"])

    def test_undeclared_condition_not_judged(self):
        rows = flag_requirements([opp("o1", phd=True)], {}, now=NOW)
        flags = rows[0]["requirements"]["flags"]
        self.assertIsNone(flags[0]["mismatch"])                # 未声明 → 不武断标红
        self.assertFalse(rows[0]["requirements"]["mismatched"])

    def test_deadline_expired_flag(self):
        rows = flag_requirements([opp("o1", deadline="2026-10-01")], {}, now=NOW)
        self.assertTrue(rows[0]["requirements"]["expired"])
        rows2 = flag_requirements([opp("o2", deadline="2026-12-31")], {}, now=NOW)
        self.assertFalse(rows2[0]["requirements"]["expired"])

    def test_no_requirements_no_flags(self):
        rows = flag_requirements([opp("o1", phd=False, enroll=False, deadline="2026-12-31")],
                                 {"phd": False}, now=NOW)
        req = rows[0]["requirements"]
        self.assertFalse(req["mismatched"])
        self.assertFalse(req["expired"])
        self.assertEqual([f for f in req["flags"] if f["mismatch"] is True], [])

    def test_deep_read_missing_still_processed(self):
        rows = flag_requirements([opp("o1", deep=False)], {}, now=NOW)
        self.assertEqual(rows[0]["requirements"]["flags"], [])


class SortTests(unittest.TestCase):
    def test_fit_first_not_silent_mixing(self):
        rows = flag_requirements([
            opp("bad", phd=True, deadline="2026-10-01"),
            opp("good", phd=False, deadline="2026-12-31"),
        ], {"phd": False}, now=NOW)
        ordered = sort_by_fit(rows)
        self.assertEqual(ordered[0]["opportunity_id"], "good")  # 符合在前
        self.assertEqual(ordered[-1]["opportunity_id"], "bad")  # 不符显式靠后
        self.assertTrue(ordered[-1]["requirements"]["mismatched"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
