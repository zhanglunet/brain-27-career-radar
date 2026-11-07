# -*- coding: utf-8 -*-
"""PRD-309/T2 机会评估重放包·replay-pack/v1 最小实现测试（trend #1557）。

覆盖（T1 设计 §1/§3/§4）：schema 组装与字段纪律（缺字段报错不猜、错误码封闭）、
fpv1 指纹稳定性、append-only 账本、verify_assessment_replay 二值结论（同输入重放
必 MATCH / 账本被篡改显形 / 重放面零写盘零投递）、与 generate_path 评估出口的
端到端装订（同输入重放 step 序列逐字节一致）。全部占位合成零网络。
"""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from path_generator import generate_path  # noqa: E402
import replay_pack as rp  # noqa: E402

TODAY = "2026-11-08"

STANDARDS = {
    "python-data": {
        "levels": {
            "1": {"criterion": "跟教程完成一次公开数据集处理流程（占位）",
                  "evidenceKinds": ["repo"], "effortBand": "S"},
            "2": {"criterion": "独立处理真实数据并产出报告（占位）",
                  "evidenceKinds": ["repo", "report"], "effortBand": "M"},
        },
        "source": "公开招聘要求（占位）",
    },
    "fmri-preproc": {
        "levels": {
            "1": {"criterion": "跟教程完成一次预处理全流程（占位）",
                  "evidenceKinds": ["repo"], "effortBand": "L"},
        },
        "deps": [{"subject": "python-data", "level": 2}],
        "source": "机会原文摘录（占位）",
    },
}

OPPS = {
    "opp-a": {"deadline": "2026-12-01"},
    "opp-b": {"deadline": "2026-12-15"},
}


def gap(subject, required, current=0, *, opp="opp-a", category="skill",
        severity=None, status="open"):
    return {
        "opportunityId": opp,
        "category": category,
        "subject": subject,
        "requiredLevel": required,
        "currentLevel": current,
        "severity": severity if severity is not None else round((required - current) / 3, 3),
        "source": {"quote": f"{subject} L{required}（占位原文）", "field": "requirements"},
        "profileEvidence": [],
        "status": status,
    }


def _run(gaps):
    return generate_path(gaps, STANDARDS, OPPS, today=TODAY)


GAPS = [
    gap("python-data", 2, 1),
    gap("fmri-preproc", 1, 0),
]


class SchemaAssemblyTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.path = _run(GAPS)
        cls.pack = rp.pack_from_assessment(GAPS, STANDARDS, OPPS, TODAY, cls.path)

    def test_pack_shape_and_inputs_selfcontained(self):
        self.assertEqual(self.pack["schema_version"], "replay-pack/v1")
        self.assertEqual(self.pack["action"], "opportunity_assessment")
        inputs = self.pack["input"]["inputs"]
        self.assertEqual(inputs["gaps"], GAPS)
        self.assertEqual(inputs["standards"], STANDARDS)
        self.assertEqual(inputs["opportunities"], OPPS)
        self.assertEqual(inputs["today"], TODAY)
        self.assertTrue(self.pack["input"]["snapshot_fingerprint"].startswith("fpv1:"))

    def test_decision_records_step_sequence_and_gate(self):
        self.assertEqual(self.pack["decision"]["rules_version"], "growth-path/v1")
        for step in self.path["steps"]:
            self.assertIn(step["subject"], self.pack["decision"]["chosen"])
        self.assertIn("PRD-175", self.pack["decision"]["why"])  # 批准门声明

    def test_output_view_records_step_ids(self):
        view = rp.output_view_of_assessment(self.path)
        self.assertEqual(view["result"]["step_ids"],
                         [s["id"] for s in self.path["steps"]])
        self.assertEqual(view["key_numbers"]["steps_total"], len(self.path["steps"]))

    def test_fingerprint_stability_and_sensitivity(self):
        p1 = rp.pack_from_assessment(GAPS, STANDARDS, OPPS, TODAY, self.path)
        p2 = rp.pack_from_assessment(GAPS, STANDARDS, OPPS, TODAY, self.path)
        self.assertEqual(p1["input"]["snapshot_fingerprint"],
                         p2["input"]["snapshot_fingerprint"])
        drifted_gaps = GAPS + [gap("extra-skill", 1, 0, opp="opp-b")]
        p3 = rp.pack_from_assessment(drifted_gaps, STANDARDS, OPPS, TODAY,
                                     _run(drifted_gaps))
        self.assertNotEqual(p3["input"]["snapshot_fingerprint"],
                            p1["input"]["snapshot_fingerprint"])


class FieldDisciplineTests(unittest.TestCase):

    def test_closed_error_vocabulary(self):
        good = dict(action="opportunity_assessment", inputs={"k": "v"},
                    decision={"chosen": "c", "why": "w", "rules_version": "v1"},
                    output={"result": "r", "key_numbers": {"n": 1}},
                    replay_command="rerun: x")
        with self.assertRaises(rp.ReplayPackError) as ei:
            rp.build_replay_pack(**{**good, "inputs": {}})
        self.assertEqual(ei.exception.code, "REPLAY_INPUT_REQUIRED")
        for drop in ("chosen", "why", "rules_version"):
            decision = {k: v for k, v in good["decision"].items() if k != drop}
            with self.assertRaises(rp.ReplayPackError) as ed:
                rp.build_replay_pack(**{**good, "decision": decision})
            self.assertEqual(ed.exception.code, "REPLAY_DECISION_FIELDS_REQUIRED")
        with self.assertRaises(ValueError):
            rp.ReplayPackError("NOT_IN_TABLE", "x")
        self.assertEqual(len(set(rp.ERROR_CODES)), len(rp.ERROR_CODES))


class LedgerTests(unittest.TestCase):

    def test_append_only_and_cold_start(self):
        pack = rp.pack_from_assessment(GAPS, STANDARDS, OPPS, TODAY, _run(GAPS))
        with tempfile.TemporaryDirectory() as tmp:
            ledger = rp.ReplayLedger(Path(tmp) / "ledger.jsonl")
            self.assertEqual(ledger.read_all(), [])
            ledger.append(pack)
            before = ledger.bytes_now()
            ledger.append(pack)
            packs = ledger.read_all()
            self.assertEqual(len(packs), 2)
            self.assertEqual(packs[0], pack)
            self.assertGreater(len(ledger.bytes_now()), len(before))


class VerifyReplayTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.pack = rp.pack_from_assessment(GAPS, STANDARDS, OPPS, TODAY, _run(GAPS))

    def test_same_inputs_replay_to_match_and_is_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = rp.ReplayLedger(Path(tmp) / "ledger.jsonl")
            ledger.append(self.pack)
            before = ledger.bytes_now()
            result = rp.verify_assessment_replay(self.pack, generate_path)
            self.assertEqual(result["status"], rp.REPLAY_MATCH)
            self.assertIsNone(result["evidence"])
            self.assertEqual(ledger.bytes_now(), before)  # 重放面只读

    def test_tampered_ledger_is_explicit_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = rp.ReplayLedger(Path(tmp) / "ledger.jsonl")
            ledger.append(self.pack)
            reloaded = rp.ReplayLedger(Path(tmp) / "ledger.jsonl").read_all()[0]
            reloaded["input"]["inputs"]["today"] = "2020-01-01"  # 篡改
            result = rp.verify_assessment_replay(reloaded, generate_path)
            self.assertEqual(result["status"], rp.REPLAY_MISMATCH)
            self.assertIn("指纹", json.dumps(result["evidence"], ensure_ascii=False))

    def test_ledger_roundtrip_replay_still_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = rp.ReplayLedger(Path(tmp) / "ledger.jsonl")
            ledger.append(self.pack)
            reloaded = rp.ReplayLedger(Path(tmp) / "ledger.jsonl").read_all()[0]
            result = rp.verify_assessment_replay(reloaded, generate_path)
            self.assertEqual(result["status"], rp.REPLAY_MATCH)


if __name__ == "__main__":
    unittest.main()
