# -*- coding: utf-8 -*-
"""PRD-231/T2 自测（trend #1156）：缺口分析——机会要求 vs 当前画像。

运行：python3 -m unittest tests.test_prd231_t2_gaps -v（仓库根执行）

覆盖（验收「缺口清单可生成且每项可溯源到机会原文」，≥8 断言）：
  技能缺口生成：required L3 vs current L1 → levelGap 2 → severity = 2/3
  必需语气系数 1.0 vs 优先语气 0.6
  levelGap=0 不生成缺口
  画像无证据按 L0 处理；有证据取其 level 并回填 profileEvidence
  溯源强制：source.quote 为机会原文逐字摘录（断言 in 原文）；无 quote 不生成
  hard_gate：severity 恒 1、单列不进 gaps
  类别映射：credential/experience；非法 category 归 skill
零网络；全合成。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from gap_analysis import analyze_gaps  # noqa: E402

OPP_ID = "opp-eeG-01"

PROFILE = [
    {"subject": "EEG 信号处理", "level": 1, "evidence": ["course:Coursera-EEG（合成）"],
     "updatedAt": "2026-10-01"},
    {"subject": "Python 数据分析", "level": 3, "evidence": ["repo:pandas-100（合成）"],
     "updatedAt": "2026-10-01"},
    {"subject": "雅思总分 7.0", "level": 2, "evidence": ["ielts:6.5（合成）"],
     "updatedAt": "2026-10-01"},
]

QUOTE_EEG = "要求掌握 EEG 信号处理，达到 L3 水平（合成原文）"
QUOTE_PYTHON = "要求 Python 数据分析达到 L3（合成原文）"


def opportunity():
    return {
        "opportunity_id": OPP_ID,
        "requirements": [
            {"subject": "EEG 信号处理", "level": 3, "quote": QUOTE_EEG,
             "field": "requirements"},
            {"subject": "Python 数据分析", "level": 3, "quote": QUOTE_PYTHON,
             "field": "requirements"},
        ],
    }


class GapAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.result = analyze_gaps(opportunity(), PROFILE)
        self.gaps = {g["subject"]: g for g in self.result["gaps"]}

    def test_skill_gap_generated_with_severity(self):
        self.assertIn("EEG 信号处理", self.gaps)
        g = self.gaps["EEG 信号处理"]
        self.assertEqual(g["requiredLevel"], 3)
        self.assertEqual(g["currentLevel"], 1)
        self.assertEqual(g["severity"], round((2 / 3) * 1.0, 3))  # levelGap 2、必需语气

    def test_essential_vs_preferred_tone(self):
        opp = opportunity()
        opp["requirements"].append(
            {"subject": "EEG 信号处理", "level": 3, "category": "skill",
             "quote": "desirable: 掌握 EEG 信号处理 L3（合成）", "field": "body"})
        # 无证据的新 subject → required 3 current 0 gap 3 → 3/3×0.6 = 0.6
        result = analyze_gaps(opp, [])
        by_subject = {g["subject"]: g for g in result["gaps"]}
        self.assertEqual(by_subject["EEG 信号处理"]["severity"], 0.6)

    def test_level_gap_zero_no_gap(self):
        opp = {"opportunity_id": OPP_ID, "requirements": [
            {"subject": "Python 数据分析", "level": 3, "quote": QUOTE_PYTHON,
             "field": "requirements"}]}
        result = analyze_gaps(opp, PROFILE)  # 画像 L3 == 要求 L3
        self.assertEqual(result["gaps"], [])

    def test_no_evidence_treated_as_l0(self):
        opp = {"opportunity_id": OPP_ID, "requirements": [
            {"subject": "预注册行为实验", "level": 2,
             "quote": "要求预注册行为实验 L2（合成原文）", "field": "requirements"}]}
        result = analyze_gaps(opp, PROFILE)
        g = result["gaps"][0]
        self.assertEqual(g["currentLevel"], 0)
        self.assertEqual(g["profileEvidence"], [])

    def test_traceability_quote_verbatim(self):
        full_text = " ".join(r["quote"] for r in opportunity()["requirements"])
        for g in self.result["gaps"]:
            self.assertIn(g["source"]["quote"], full_text)  # 逐字摘录可溯源
            self.assertEqual(g["source"]["field"], "requirements")

    def test_missing_quote_skipped(self):
        opp = {"opportunity_id": OPP_ID, "requirements": [
            {"subject": "无出处要求", "level": 3, "quote": "", "field": "requirements"}]}
        result = analyze_gaps(opp, PROFILE)
        self.assertEqual(result["gaps"], [])  # 无原文不生成（不臆判）

    def test_hard_gate_single_list_severity_one(self):
        opp = {"opportunity_id": OPP_ID, "requirements": [
            {"subject": "已获博士学位", "quote": "仅限已获博士学位者（合成原文）",
             "field": "requirements", "hard_gate": True}]}
        result = analyze_gaps(opp, PROFILE)
        self.assertEqual(len(result["hard_gates"]), 1)
        self.assertEqual(result["hard_gates"][0]["severity"], 1)
        self.assertEqual(result["gaps"], [])  # 单列不进缺口路径

    def test_category_mapping(self):
        opp = {"opportunity_id": OPP_ID, "requirements": [
            {"subject": "雅思总分 7.0", "level": 3, "category": "credential",
             "quote": "要求雅思总分 7.0（合成原文）", "field": "requirements"},
            {"subject": "独立负责实验", "level": 2, "category": "experience",
             "quote": "要求有独立负责实验经历 L2（合成原文）", "field": "requirements"},
            {"subject": "未知类要求", "level": 1,
             "quote": "要求未知类 L1（合成原文）", "field": "requirements",
             "category": "mystery"}]}
        result = analyze_gaps(opp, [])
        cats = {g["subject"]: g["category"] for g in result["gaps"]}
        self.assertEqual(cats["雅思总分 7.0"], "credential")
        self.assertEqual(cats["独立负责实验"], "experience")
        self.assertEqual(cats["未知类要求"], "skill")  # 非法归 skill


if __name__ == "__main__":
    unittest.main(verbosity=2)
