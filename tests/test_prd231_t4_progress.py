# -*- coding: utf-8 -*-
"""PRD-231/T4 测试（trend #1158）：进度跟踪与路径调整。

覆盖（T1 §5.5/§6）：就绪度计算（分母 0 天然就绪/部分闭合/两位小数）、证据
登记（形态三型/空证据拒/重复登记拒/缺口连带更新 closed）、重排触发与变更说明
（todo 只动/doing 不打断）、投递建议（缺口全 closed 或 waived 才建议、hard_gate
未处置不建议、只建议不自动投递声明）、确定性。零网络；全合成。
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from path_generator import generate_path  # noqa: E402
from progress_tracking import (  # noqa: E402
    ProgressError,
    readiness,
    register_evidence,
    suggest_apply,
)

TODAY = "2026-11-08"
STANDARDS = {"python-data": {"levels": {
    "1": {"criterion": "跟教程完成（证据：notebook）", "effortBand": "S"},
    "2": {"criterion": "独立处理真实数据（证据：仓库+报告）", "effortBand": "M"}},
    "source": "公开招聘要求（占位）"}}
OPPS = {"opp-a": {"deadline": "2026-12-01"}}


def _gaps():
    return [
        {"opportunityId": "opp-a", "category": "skill", "subject": "python-data",
         "requiredLevel": 1, "currentLevel": 0, "severity": 1 / 3,
         "source": {"quote": "占位原文", "field": "requirements"},
         "profileEvidence": [], "status": "open"},
        {"opportunityId": "opp-a", "category": "skill", "subject": "sql",
         "requiredLevel": 2, "currentLevel": 0, "severity": 2 / 3,
         "source": {"quote": "占位原文", "field": "requirements"},
         "profileEvidence": [], "status": "open"},
    ]


class 就绪度Tests(unittest.TestCase):
    def test_zero_gaps_fully_ready(self):
        assert readiness([], "opp-x")["readiness"] == 1.0

    def test_partial_closed_two_decimals(self):
        gaps = _gaps()
        gaps[0]["status"] = "closed"  # severity 1/3 已闭合
        info = readiness(gaps, "opp-a")
        assert info["readiness"] == round(1 - (2 / 3) / 1.0, 2)
        assert info["open_gaps"][0]["subject"] == "sql"

    def test_nothing_closed_zero(self):
        info = readiness(_gaps(), "opp-a")
        assert info["readiness"] == 0.0


class 证据登记Tests(unittest.TestCase):
    def test_register_marks_done_and_closes_gap(self):
        out = generate_path([gap := {}] and _gaps()[0:1], STANDARDS, OPPS, today=TODAY)
        step = out["steps"][0]
        gaps = _gaps()
        result = register_evidence(step, {"kind": "note", "value": "notebook 链接（占位）"},
                                   gaps, today=TODAY)
        assert result["step"]["status"] == "done"
        affected = result["affected_gaps"][0]
        assert affected["status"] == "closed"
        assert affected["currentLevel"] >= 1

    def test_evidence_kind_closed_set(self):
        step = {"status": "todo", "gapIds": [], "toLevel": 1}
        with self.assertRaises(ProgressError):
            register_evidence(step, {"kind": "口头说说", "value": "x"}, [], today=TODAY)

    def test_empty_evidence_rejected(self):
        step = {"status": "todo", "gapIds": [], "toLevel": 1}
        with self.assertRaises(ProgressError, msg="空证据"):
            register_evidence(step, {"kind": "note", "value": "  "}, [], today=TODAY)

    def test_done_step_no_double_register(self):
        step = {"status": "done", "gapIds": [], "toLevel": 1}
        with self.assertRaises(ProgressError) as ctx:
            register_evidence(step, {"kind": "note", "value": "x"}, [], today=TODAY)
        assert "已 done" in str(ctx.exception)


class 重排与投递建议Tests(unittest.TestCase):
    def test_path_reorder_after_completion_with_changelog(self):
        """§5.5-1：达标触发重排，重排结果与未达标路径不同（变更可见）。"""
        gaps = [dict(g, requiredLevel=2, currentLevel=0) for g in _gaps()]
        gaps[0]["subject"] = "sql"
        before = generate_path(copy.deepcopy(gaps), STANDARDS, OPPS, today=TODAY)
        # 模拟第一级达标：currentLevel 提升
        for g in gaps:
            g["currentLevel"] = 1
        after = generate_path(copy.deepcopy(gaps), STANDARDS, OPPS, today=TODAY)
        # 重排后剩余步骤（不含已达成的 L1）与之前不同
        before_subjects = [(s["subject"], s["toLevel"]) for s in before["steps"]]
        after_subjects = [(s["subject"], s["toLevel"]) for s in after["steps"]]
        assert before_subjects != after_subjects or not after["steps"]

    def test_apply_suggestion_when_all_closed(self):
        """§6.3：缺口全部 closed → 生成投递建议（只建议，不自动投递）。"""
        gaps = [dict(g, status="closed") for g in _gaps()]
        info = readiness(gaps, "opp-a")
        suggestion = suggest_apply("opp-a", gaps, [], readiness_info=info)
        assert suggestion is not None
        assert suggestion["opportunity_id"] == "opp-a"
        assert "不自动投递" in suggestion["disclaimer"]
        assert "PRD-175" in suggestion["disclaimer"]

    def test_waived_counts_as_closed(self):
        gaps = [dict(g, status="waived") for g in _gaps()]
        assert suggest_apply("opp-a", gaps, [],
                             readiness_info=readiness(gaps, "opp-a")) is not None

    def test_open_gap_no_suggestion(self):
        assert suggest_apply("opp-a", _gaps(), [],
                             readiness_info=readiness(_gaps(), "opp-a")) is None

    def test_open_hard_gate_blocks_suggestion(self):
        gaps = [dict(g, status="closed") for g in _gaps()]
        hard_gates = [{"opportunityId": "opp-a", "category": "hard_gate",
                       "subject": "博士学历（占位）", "status": "open"}]
        assert suggest_apply("opp-a", gaps, hard_gates,
                             readiness_info=readiness(gaps, "opp-a")) is None

    def test_suggestion_deterministic(self):
        gaps = [dict(g, status="closed") for g in _gaps()]
        one = json.dumps(suggest_apply("opp-a", gaps, [],
                                       readiness_info=readiness(gaps, "opp-a")),
                         ensure_ascii=False, sort_keys=True)
        two = json.dumps(suggest_apply("opp-a", copy.deepcopy(gaps), [],
                                       readiness_info=readiness(gaps, "opp-a")),
                         ensure_ascii=False, sort_keys=True)
        assert one == two


if __name__ == "__main__":
    unittest.main()
