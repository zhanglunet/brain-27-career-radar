# -*- coding: utf-8 -*-
"""PRD-231/T5 测试：验收试运行——以真实目标岗位回放（trend #1159）。

运行：python3 -m unittest tests.test_prd231_t5_job_replay -v（仓库根执行）

验收标准（trend #1159）：**生成路径与人工规划大体一致，分歧有说明**。

回放（真实代码全链，岗位/画像/规划全合成占位）：目标岗位 JD（requirements
带原文 quote）→ analyze_gaps 缺口分析 → generate_path 学习路径 → 对照同一
岗位的人工规划（planner 手拟的练什么/顺序）逐项核对：
  大体一致：路径 steps 覆盖人工规划全部必修项（覆盖率高），顺序与
  依赖方向一致（依赖先行）；
  分歧有说明：生成多出/剔除的每一项都能在 observations/excluded/deps
  留痕里找到原因说明（进阶链多出 L1→依据依赖声明；过期机会剔除→
  excluded 留痕；无标准表 subject→observation 不静默）。
零网络；全合成。
"""
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from gap_analysis import analyze_gaps  # noqa: E402
from path_generator import generate_path  # noqa: E402
from progress_tracking import readiness, register_evidence, suggest_apply  # noqa: E402

TODAY = "2026-11-08"

#: 真实目标岗位（合成占位）：脑机接口算法工程师，JD 三条要求带原文
JOB = {
    "opportunity_id": "opp-bci-2026",
    "deadline": "2026-12-20",
    "requirements": [
        {"subject": "Python 数据分析", "level": 2,
         "quote": "熟练使用 Python 进行数据分析，能独立产出分析报告（合成原文）",
         "field": "requirements"},
        {"subject": "EEG 信号处理", "level": 3,
         "quote": "掌握 EEG 信号预处理与特征提取，达到 L3（合成原文）",
         "field": "requirements"},
        {"subject": "雅思总分 7.0", "level": 1,
         "quote": "英语能力证明：雅思总分 7.0 或同等（合成原文）",
         "field": "requirements"},
        {"subject": "fMRI 预处理", "level": 1,
         "quote": "有 fMRI 数据预处理经验者优先（合成原文）",
         "field": "requirements", "hard_gate": False},
    ],
}

PROFILE = [
    {"subject": "Python 数据分析", "level": 1, "evidence": ["course:py101（合成）"],
     "updatedAt": "2026-11-01"},
    {"subject": "EEG 信号处理", "level": 1, "evidence": ["course:Coursera-EEG（合成）"],
     "updatedAt": "2026-11-01"},
    # 雅思不在画像中（无证据）→ 缺口 currentLevel=0
]

STANDARDS = {
    "Python 数据分析": {"levels": {"2": {
        "criterion": "独立处理一份真实数据并产出结果报告（证据：仓库+报告）",
        "evidenceKinds": ["repo", "report"], "effortBand": "M"}},
        "source": "JD 原文（占位）"},
    "EEG 信号处理": {"levels": {
        "1": {"criterion": "跟教程完成一次公开 EEG 数据预处理，记录可复跑（证据：notebook）",
              "evidenceKinds": ["repo"], "effortBand": "M"},
        "2": {"criterion": "完成一次 EEG 特征提取小实验并写方法说明（证据：仓库+说明）",
              "evidenceKinds": ["repo", "report"], "effortBand": "L"},
        "3": {"criterion": "独立完成一份 EEG 分析管线并给出结果报告（证据：仓库+报告）",
              "evidenceKinds": ["repo", "report"], "effortBand": "XL"}},
        "deps": [{"subject": "Python 数据分析", "level": 2}],
        "source": "JD 原文（占位）"},
    "雅思总分 7.0": {"levels": {"1": {
        "criterion": "雅思总分 ≥ 7.0（证据：成绩单/证书编号）",
        "evidenceKinds": ["certificate"], "effortBand": "XL"}},
        "source": "JD 原文（占位）"},
    # 注意：fMRI 预处理故意不在标准表——观察记录路径（不静默）
}

#: 人工规划（planner 手拟，合成占位）：练什么 + 顺序
HUMAN_PLAN = {
    "must": ["Python 数据分析", "EEG 信号处理", "雅思总分 7.0"],
    "order": ["Python 数据分析", "EEG 信号处理", "雅思总分 7.0"],  # 依赖先行
    "not_planned": ["fMRI 预处理"],                     # 人工判断本期不练（无标准表）
}


class 岗位回放Tests(unittest.TestCase):
    def setUp(self):
        self.gap_result = analyze_gaps(JOB, PROFILE)
        self.gaps = self.gap_result["gaps"]
        self.path = generate_path(self.gaps, STANDARDS, {"opp-bci-2026": JOB},
                                  today=TODAY)
        self.steps = self.path["steps"]

    def test_full_chain_produces_path(self):
        """全链回放：JD→缺口→路径，每步 criterion 齐备可检验。"""
        subjects = {g["subject"] for g in self.gaps}
        self.assertEqual(subjects, {"Python 数据分析", "EEG 信号处理",
                                    "雅思总分 7.0", "fMRI 预处理"})
        self.assertGreater(len(self.steps), 0)
        for step in self.steps:
            self.assertTrue(step["criterion"])
            self.assertEqual(step["status"], "todo")

    def test_path_covers_human_plan(self):
        """验收①大体一致：路径覆盖人工规划全部必修项 + 依赖顺序一致。"""
        path_subjects = {s["subject"] for s in self.steps}
        for must in HUMAN_PLAN["must"]:
            self.assertIn(must, path_subjects, f"人工必修 {must} 未进路径")
        # 顺序：Python 依赖（EEG 的 deps）先于 EEG 步骤
        order = [s["subject"] for s in self.steps]
        if "Python 数据分析" in order and "EEG 信号处理" in order:
            self.assertLess(order.index("Python 数据分析"),
                            order.index("EEG 信号处理"))

    def test_divergences_all_explained(self):
        """验收②分歧有说明：每一处与人工规划的分歧均有留痕说明。"""
        # 分歧 A：EEG 进阶链多出 L1→L2 中间步（人工只看终态 L3）——
        #   生成依据标准表 levels 进阶链与 deps 依赖声明，每步可溯源
        eeg_steps = [s for s in self.steps if s["subject"] == "EEG 信号处理"]
        self.assertGreaterEqual(len(eeg_steps), 2)         # L1→L2→L3 进阶链
        for step in eeg_steps:
            self.assertTrue(STANDARDS["EEG 信号处理"]["levels"][str(step["toLevel"])]
                            ["criterion"])                 # 每步依据标准表
        # 分歧 B：fMRI 预处理无标准表 → 不进路径但 observation 不静默（有原因说明）
        path_subjects = {s["subject"] for s in self.steps}
        self.assertNotIn("fMRI 预处理", path_subjects)
        observations = self.path.get("observations", [])
        self.assertTrue(any("fMRI" in json_dumps(o) for o in observations),
                        observations)
        # 分歧 C：Python 步骤的 drivenBy 引用机会与截止日（排序依据可说明）
        py_steps = [s for s in self.steps if s["subject"] == "Python 数据分析"]
        self.assertTrue(py_steps)
        self.assertEqual(py_steps[0]["drivenBy"]["opportunityId"], "opp-bci-2026")

    def test_readiness_and_apply_suggestion_flow(self):
        """就绪度→证据登记→投递建议：回放闭环，建议只提示不自动投递。"""
        r0 = readiness(self.gaps, "opp-bci-2026")
        self.assertLess(r0["readiness"], 1.0)
        # 逐项关闭缺口（证据登记形态核对）→ readiness 上升 → 建议出现
        closed = []
        for g in self.gaps:
            if g["category"] == "hard_gate":
                continue
            closed.append(dict(g, status="closed"))
        r1 = readiness(closed, "opp-bci-2026")
        self.assertGreater(r1["readiness"], r0["readiness"])
        suggestion = suggest_apply("opp-bci-2026", closed, [], readiness_info=r1)
        self.assertIsNotNone(suggestion)
        self.assertIn("不自动投递", suggestion["disclaimer"])


def json_dumps(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
