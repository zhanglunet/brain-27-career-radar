# -*- coding: utf-8 -*-
"""PRD-231/T3 测试：学习路径生成——练什么/顺序/达标标准（trend #1157）。

运行：python3 -m unittest test_prd231_t3_path -v（本目录）

覆盖（T1 §3.5/§5）：核心验收「路径每步带可检验的达标标准」——criterion 逐字
引用标准表（substring 断言）；截止日驱动排序（过期剔除留痕/无 deadline 排后）；
进阶链与低阶连带；跨机会合并（gapIds 收集/最早 deadline/severity 取最大/同类别
限定）；跨技能依赖拓扑序与成环报错给人工；性价比排序；无标准表 observation 不
静默；hard_gate 不进路径；确定性。零网络；全合成。
"""
import copy
import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from path_generator import PathError, generate_path  # noqa: E402

TODAY = "2026-11-08"

STANDARDS = {
    "python-data": {
        "levels": {
            "1": {"criterion": "跟教程完成一次公开数据集处理流程，记录可打开复跑（证据：notebook 仓库）",
                  "evidenceKinds": ["repo"], "effortBand": "S"},
            "2": {"criterion": "独立处理一份真实数据并产出结果报告，参数选择有书面理由（证据：仓库+报告）",
                  "evidenceKinds": ["repo", "report"], "effortBand": "M"},
        },
        "source": "公开招聘要求（占位）",
    },
    "fmri-preproc": {
        "levels": {
            "1": {"criterion": "跟教程完成一次公开 fMRI 数据预处理全流程，记录可复跑（证据：notebook）",
                  "evidenceKinds": ["repo"], "effortBand": "L"},
        },
        "deps": [{"subject": "python-data", "level": 2}],  # 跨技能依赖声明
        "source": "机会原文摘录（占位）",
    },
    "ielts": {
        "levels": {
            "1": {"criterion": "雅思总分 ≥ 7.0 且单项 ≥ 6.5（证据：成绩单/证书编号）",
                  "evidenceKinds": ["certificate"], "effortBand": "XL"},
        },
        "source": "机会原文摘录（占位）",
    },
}

OPPS = {
    "opp-a": {"deadline": "2026-12-01"},
    "opp-b": {"deadline": "2026-12-15"},
    "opp-late": {"deadline": "2026-11-01"},   # 已过期
    "opp-open": {"deadline": None},
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


class 达标标准Tests(unittest.TestCase):
    def test_criterion_verbatim_from_standard(self):
        """核心验收：每步 criterion 逐字引用标准表该级判据（不另行改写）。"""
        out = generate_path([gap("python-data", 2, 0)], STANDARDS, OPPS, today=TODAY)
        self.assertEqual(len(out["steps"]), 2)  # L1、L2 进阶链
        for step in out["steps"]:
            spec = STANDARDS["python-data"]["levels"][str(step["toLevel"])]
            self.assertIn(spec["criterion"], step["criterion"])
            self.assertTrue(step["criterion"])  # 非空可检验判据
            self.assertIn("证据", step["criterion"])  # 判据含证据形态（§4.2）

    def test_step_shape_complete(self):
        out = generate_path([gap("python-data", 1)], STANDARDS, OPPS, today=TODAY)
        step = out["steps"][0]
        for field in ("id", "gapIds", "subject", "category", "fromLevel", "toLevel",
                      "action", "criterion", "effortBand", "drivenBy", "status"):
            self.assertIn(field, step)
        self.assertEqual(step["status"], "todo")
        self.assertEqual(step["drivenBy"], {"opportunityId": "opp-a",
                                            "deadline": "2026-12-01"})


class 截止日驱动Tests(unittest.TestCase):
    def test_expired_deadline_excluded_with_trace(self):
        """已过 deadline 的机会缺口不进路径（§3.5），excluded 留痕不静默。"""
        out = generate_path([gap("python-data", 1, opp="opp-late")], STANDARDS, OPPS,
                            today=TODAY)
        self.assertEqual(out["steps"], [])
        self.assertEqual(len(out["excluded"]), 1)
        self.assertEqual(out["excluded"][0]["reason"], "deadline_passed")

    def test_no_deadline_sorts_after_deadline_driven(self):
        out = generate_path([
            gap("python-data", 1, opp="opp-open"),
            gap("ielts", 1, opp="opp-a", category="credential"),
        ], STANDARDS, OPPS, today=TODAY)
        self.assertEqual([s["subject"] for s in out["steps"]],
                         ["ielts", "python-data"])  # 有 deadline 先

    def test_earlier_deadline_first(self):
        out = generate_path([
            gap("python-data", 1, opp="opp-b"),
            gap("ielts", 1, opp="opp-a", category="credential"),
        ], STANDARDS, OPPS, today=TODAY)
        self.assertEqual(out["steps"][0]["subject"], "ielts")  # opp-a 12-01 先


class 合并与进阶链Tests(unittest.TestCase):
    def test_cross_opportunity_merge_same_level(self):
        """同 subject 同 requiredLevel 跨机会合并：gapIds 收集、drivenBy 最早、severity 取最大。"""
        out = generate_path([
            gap("python-data", 1, severity=0.3, opp="opp-b"),
            gap("python-data", 1, severity=0.6, opp="opp-a"),
        ], STANDARDS, OPPS, today=TODAY)
        self.assertEqual(len(out["steps"]), 1)
        step = out["steps"][0]
        self.assertEqual(len(step["gapIds"]), 2)
        self.assertEqual(step["drivenBy"]["deadline"], "2026-12-01")  # 最早
        self.assertEqual(step["effortBand"], "S")  # 标准表 L1 S

    def test_progression_chain_serves_lower_requirements(self):
        """同 subject 不同级 → 进阶链；L1 步同时服务 L1 缺口（低阶连带）。"""
        out = generate_path([
            gap("python-data", 2, current=0, opp="opp-a"),
            gap("python-data", 1, current=0, opp="opp-b"),
        ], STANDARDS, OPPS, today=TODAY)
        self.assertEqual([(s["fromLevel"], s["toLevel"]) for s in out["steps"]],
                         [(0, 1), (1, 2)])
        self.assertEqual(len(out["steps"][0]["gapIds"]), 2)  # L1 步服务两个缺口

    def test_merge_not_across_categories(self):
        """skill 与 credential 不合并（§5.4）：同 subject 不同类别各自成步。"""
        standards = dict(STANDARDS, ielts={
            "levels": STANDARDS["ielts"]["levels"], "source": "占位"})
        out = generate_path([
            gap("ielts", 1, category="credential", opp="opp-a"),
            gap("ielts", 1, category="skill", opp="opp-b"),
        ], standards, OPPS, today=TODAY)
        self.assertEqual(len(out["steps"]), 2)


class 依赖与排序Tests(unittest.TestCase):
    def test_dependency_topological_order(self):
        """fMRI 依赖 python-data L2 → python-data 两步全部先排。"""
        out = generate_path([
            gap("fmri-preproc", 1, opp="opp-a"),
            gap("python-data", 2, opp="opp-b"),
        ], STANDARDS, OPPS, today=TODAY)
        subjects = [s["subject"] for s in out["steps"]]
        self.assertEqual(subjects.index("python-data") < subjects.index("fmri-preproc"), True)
        self.assertEqual(subjects[-1], "fmri-preproc")

    def test_dependency_cycle_raises_for_human(self):
        """成环 → PathError 报错给人工，不静默乱序（§5.2-2）。"""
        cyclic = dict(STANDARDS)
        cyclic["python-data"] = dict(STANDARDS["python-data"],
                                     deps=[{"subject": "fmri-preproc", "level": 1}])
        cyclic["fmri-preproc"] = dict(STANDARDS["fmri-preproc"],
                                      deps=[{"subject": "python-data", "level": 2}])
        with self.assertRaises(PathError):
            generate_path([gap("fmri-preproc", 1)], cyclic, OPPS, today=TODAY)

    def test_cost_effectiveness_within_same_window(self):
        """同 deadline 窗口、依赖满足：severity/effort 权重高者先（又重要又快）。"""
        out = generate_path([
            gap("python-data", 1, opp="opp-a", severity=0.3),   # weight 0.3/4=0.075
            gap("ielts", 1, opp="opp-a", category="credential", severity=0.6),  # 0.6/0.5=1.2
        ], STANDARDS, OPPS, today=TODAY)
        self.assertEqual(out["steps"][0]["subject"], "ielts")


class 静默红线Tests(unittest.TestCase):
    def test_missing_standard_observed_not_silent(self):
        """无标准表条目 → observation（standard_missing），不产步骤。"""
        out = generate_path([gap("ghost-skill", 2)], STANDARDS, OPPS, today=TODAY)
        self.assertEqual(out["steps"], [])
        self.assertEqual(out["observations"][0]["kind"], "standard_missing")

    def test_missing_level_criterion_observed(self):
        """标准表缺 L1 判据 → observation（standard_level_missing）；L2 有判据
        仍产步（缺级显式留痕，用户可经其他途径补 L1）。"""
        standards = {"half-standard": {"levels": {"2": {
            "criterion": "独立完成（证据：报告）", "evidenceKinds": ["report"]}},
            "source": "占位"}}
        out = generate_path([gap("half-standard", 2)], standards, OPPS, today=TODAY)
        self.assertEqual([s["toLevel"] for s in out["steps"]], [2])
        self.assertEqual(out["observations"][0]["kind"], "standard_level_missing")

    def test_hard_gate_not_in_path(self):
        out = generate_path([gap("博士学历", 1, category="hard_gate")], STANDARDS, OPPS,
                            today=TODAY)
        self.assertEqual(out["steps"], [])

    def test_deterministic(self):
        gaps = [gap("python-data", 2), gap("ielts", 1, category="credential", opp="opp-b"),
                gap("fmri-preproc", 1, opp="opp-a")]
        one = generate_path(copy.deepcopy(gaps), copy.deepcopy(STANDARDS),
                            copy.deepcopy(OPPS), today=TODAY)
        two = generate_path(copy.deepcopy(gaps), copy.deepcopy(STANDARDS),
                            copy.deepcopy(OPPS), today=TODAY)
        self.assertEqual(json.dumps(one, ensure_ascii=False, sort_keys=True),
                         json.dumps(two, ensure_ascii=False, sort_keys=True))

    def test_summary_no_auto_apply(self):
        out = generate_path([gap("python-data", 1)], STANDARDS, OPPS, today=TODAY)
        self.assertIn("不自动投递", out["summary"]["note"])


if __name__ == "__main__":
    unittest.main()
