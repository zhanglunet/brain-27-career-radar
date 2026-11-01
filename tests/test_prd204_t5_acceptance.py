# -*- coding: utf-8 -*-
"""PRD-204/T5 自测（trend #1024）：验收——跨会话演练记录完整。

运行：python3 -m unittest tests.test_prd204_t5_acceptance -v（仓库根执行）

演练三幕（T3 续跑概览 + T4 只读快照串联）：
  会话 A：事件落库 → brief 概览准确复述
  会话 B（新开）：快照指纹一致 → 状态变化后指纹变化（文档过期引用可识别）
  会话 C：拒绝事件后 brief 收尾计数更新，快照只读不回写
零网络；全合成。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from job_doc_snapshot import doc_context, snapshot_digest, state_snapshot  # noqa: E402
from job_session_brief import build_session_brief, render_brief  # noqa: E402
from job_state_memory import JobStateMemory  # noqa: E402


class RehearsalTests(unittest.TestCase):
    def test_three_session_rehearsal(self):
        # ── 会话 A：投递 + 面试 ──
        mem = JobStateMemory()
        mem.record_event("甲公司（虚构）", "算法工程师", "applied", "2026-10-20T09:00:00+00:00")
        mem.record_event("甲公司（虚构）", "算法工程师", "interview", "2026-10-25T14:00:00+00:00",
                         note="一面通过（虚构）")
        mem.record_event("乙公司（虚构）", "数据分析师", "applied", "2026-10-22T10:00:00+00:00")
        brief_a = build_session_brief(mem)
        self.assertEqual(brief_a["counts"] if "counts" in brief_a else
                         sum(1 for _ in brief_a["items"]), 2)
        self.assertIn("甲公司（虚构）", brief_a["items"][0])

        # ── 会话 B（新开）：快照指纹一致，之后状态变化 → 指纹变 ──
        snap_b = state_snapshot(mem)
        digest_b = snapshot_digest(snap_b)
        ctx_b = doc_context(mem)
        self.assertEqual(ctx_b["snapshot_digest"], digest_b)   # 只读快照指纹一致
        mem.record_event("丙公司（虚构）", "产品经理", "applied", "2026-10-28T09:00:00+00:00")
        self.assertNotEqual(snapshot_digest(state_snapshot(mem)), digest_b)

        # ── 会话 C：拒绝事件 → 收尾计数更新；快照不回写 ──
        mem.record_event("乙公司（虚构）", "数据分析师", "rejected", "2026-10-29T10:00:00+00:00")
        brief_c = build_session_brief(mem)
        self.assertIn("进行中 2 条", brief_c["summary"])        # 3 投 -1 面试 -1 拒 = 2
        self.assertEqual(brief_c["finished_count"], 1)
        snap_c = state_snapshot(mem)
        snap_c["items"].clear()                                # 文档侧乱改
        self.assertTrue(state_snapshot(mem)["items"])          # 状态层不受影响
        # 演练记录可序列化落盘
        import json
        record = {"brief_a": brief_a["summary"], "digest_b": digest_b,
                  "brief_c": brief_c["summary"]}
        json.dumps(record, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
