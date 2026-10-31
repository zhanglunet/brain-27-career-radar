# -*- coding: utf-8 -*-
"""PRD-204/T3 自测（trend #1022）：会话开启续跑注入——先给「进行中」概览。

运行：python3 -m unittest tests.test_prd204_t3_brief -v（仓库根执行）

覆盖（验收「新会话可准确复述状态」）：
  brief 摘要行：进行中计数按状态分组准确
  逐条复述：公司/岗位/状态/最近事件@时间 全部来自记录（零虚构）
  终态（rejected/withdrawn）不进正文只给计数
  最近事件时间倒序
  空库 → 明确「没有进行中」
  渲染文本可复述：每条进行中记录的关键字段都在文本中

虚构纪律：公司/岗位全虚构；零网络。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from job_session_brief import build_session_brief, render_brief  # noqa: E402
from job_state_memory import JobStateMemory  # noqa: E402


def seeded_memory():
    mem = JobStateMemory()
    mem.record_event("甲公司（虚构）", "算法工程师", "applied", "2026-10-20T09:00:00+00:00")
    mem.record_event("甲公司（虚构）", "算法工程师", "interview", "2026-10-25T14:00:00+00:00",
                     note="一面通过（虚构）")
    mem.record_event("乙公司（虚构）", "数据分析师", "applied", "2026-10-22T10:00:00+00:00")
    mem.record_event("丙公司（虚构）", "产品经理", "rejected", "2026-10-18T09:00:00+00:00")
    return mem


class BriefTests(unittest.TestCase):
    def test_summary_counts_by_status(self):
        brief = build_session_brief(seeded_memory())
        self.assertIn("进行中 2 条", brief["summary"])
        self.assertIn("面试中 1 条", brief["summary"])
        self.assertIn("已投递 1 条", brief["summary"])
        self.assertEqual(brief["finished_count"], 1)  # 丙公司已拒 → 只计数

    def test_items_accurate_restatement(self):
        brief = build_session_brief(seeded_memory())
        self.assertEqual(len(brief["items"]), 2)
        joined = "\n".join(brief["items"])
        self.assertIn("甲公司（虚构） · 算法工程师 · 面试中", joined)
        self.assertIn("interview@2026-10-25T14:00:00+00:00", joined)
        self.assertIn("一面通过（虚构）", joined)          # 最近事件 note 可复述
        self.assertIn("乙公司（虚构） · 数据分析师 · 已投递", joined)
        self.assertNotIn("丙公司", joined)                 # 终态不进正文

    def test_newest_first(self):
        mem = seeded_memory()
        mem.record_event("丁公司（虚构）", "研究员", "applied", "2026-10-28T09:00:00+00:00")
        brief = build_session_brief(mem)
        self.assertIn("丁公司", brief["items"][0])  # 最近更新在前

    def test_empty_memory(self):
        brief = build_session_brief(JobStateMemory())
        self.assertIn("没有进行中", brief["summary"])
        self.assertEqual(brief["items"], [])

    def test_render_restatable(self):
        text = render_brief(build_session_brief(seeded_memory()))
        for token in ("甲公司（虚构）", "算法工程师", "面试中", "乙公司（虚构）",
                      "已投递", "另有 1 条已结束"):
            self.assertIn(token, text)  # 新会话据此可准确复述


if __name__ == "__main__":
    unittest.main(verbosity=2)
