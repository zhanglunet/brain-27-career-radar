# -*- coding: utf-8 -*-
"""PRD-204/T4 自测（trend #1023）：与 PRD-150 文档生成对接（状态喂给文档生成）。

运行：python3 -m unittest tests.test_prd204_t4_snapshot -v（仓库根执行）

覆盖（验收「文档引用最新状态」）：
  只读快照：深拷贝——文档侧改动不回写状态层（§1.2 划界）
  快照内容：进行中条目 + 状态分组计数 + 最近事件；终态只计数
  snapshot_digest：状态一变 digest 就变（文档可判断是否引用最新）
  doc_context：readonly=True + 快照 + 指纹；digest 与快照一致

虚构纪律：公司/岗位全虚构；零网络。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from job_doc_snapshot import doc_context, snapshot_digest, state_snapshot  # noqa: E402
from job_state_memory import JobStateMemory  # noqa: E402


def seeded():
    mem = JobStateMemory()
    mem.record_event("甲公司（虚构）", "算法工程师", "applied", "2026-10-20T09:00:00+00:00")
    mem.record_event("甲公司（虚构）", "算法工程师", "interview", "2026-10-25T14:00:00+00:00")
    mem.record_event("乙公司（虚构）", "数据分析师", "applied", "2026-10-22T10:00:00+00:00")
    mem.record_event("丙公司（虚构）", "产品经理", "rejected", "2026-10-18T09:00:00+00:00")
    return mem


class SnapshotTests(unittest.TestCase):
    def test_readonly_no_writeback(self):
        mem = seeded()
        snapshot = state_snapshot(mem)
        snapshot["items"][0]["status"] = "被文档侧改掉"      # 文档侧手滑改快照
        fresh = state_snapshot(mem)
        self.assertEqual(fresh["items"][0]["status"], "interviewing")  # 不回写状态层
        self.assertNotIn("被文档侧改掉", str(state_snapshot(mem)))

    def test_snapshot_contents(self):
        snapshot = state_snapshot(seeded())
        self.assertEqual(snapshot["counts"]["active"], 2)
        self.assertEqual(snapshot["counts"]["interviewing"], 1)
        self.assertEqual(snapshot["finished_count"], 1)        # 终态只计数
        first = snapshot["items"][0]                           # 最近更新在前
        self.assertEqual(first["company"], "甲公司（虚构）")
        self.assertEqual(first["status_label"], "面试中")

    def test_digest_changes_with_state(self):
        mem = seeded()
        before = snapshot_digest(state_snapshot(mem))
        mem.record_event("乙公司（虚构）", "数据分析师", "interview",
                         "2026-10-28T10:00:00+00:00")
        after = snapshot_digest(state_snapshot(mem))
        self.assertNotEqual(before, after)                     # 状态一变指纹就变


class DocContextTests(unittest.TestCase):
    def test_context_readonly_and_digest(self):
        mem = seeded()
        ctx = doc_context(mem)
        self.assertTrue(ctx["readonly"])
        self.assertEqual(ctx["snapshot_digest"], snapshot_digest(ctx["snapshot"]))
        self.assertIn("不写 materials", ctx["note"])

    def test_document_can_detect_stale_reference(self):
        mem = seeded()
        ctx = doc_context(mem)
        stale_digest = ctx["snapshot_digest"]
        mem.record_event("丁公司（虚构）", "研究员", "applied", "2026-10-29T09:00:00+00:00")
        current = snapshot_digest(state_snapshot(mem))
        self.assertNotEqual(stale_digest, current)             # 文档引用过期可识别
        self.assertNotIn("丁公司", str(ctx["snapshot"]))       # 旧快照确实没有新条目


if __name__ == "__main__":
    unittest.main(verbosity=2)
