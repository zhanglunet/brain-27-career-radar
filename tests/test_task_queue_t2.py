# -*- coding: utf-8 -*-
"""PRD-232/T2 自测（trend #1161）：任务队列——四状态流转全程留痕。

运行：python3 -m unittest tests.test_task_queue_t2 -v（仓库根执行）

覆盖（验收「机会可在四状态间流转且全程留痕」）：
  正常链：queued → following → interviewing → rejected 全程留痕
  快捷路径：queued → rejected 直接拒
  非法流转：queued → interviewing 跳级拒绝；rejected 终态封死
  事件只追加：流转后 events 不丢
零网络；全合成。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from task_queue import QueueError, TaskQueue  # noqa: E402

AT1 = "2026-10-20T09:00:00+00:00"
AT2 = "2026-10-25T14:00:00+00:00"
AT3 = "2026-10-28T10:00:00+00:00"
AT4 = "2026-10-30T10:00:00+00:00"


class TaskQueueTests(unittest.TestCase):
    def test_full_chain_with_events(self):
        q = TaskQueue()
        q.add("t1", "甲公司（虚构）", "算法工程师", AT1)
        q.transition("t1", "following", reason="投递完成", at=AT2)
        q.transition("t1", "interviewing", reason="收到面试邀约", at=AT3)
        q.transition("t1", "rejected", reason="一面未过", at=AT4)
        self.assertEqual(len(q.events), 4)
        statuses = [e["to"] for e in q.events]
        self.assertEqual(statuses, ["queued", "following", "interviewing", "rejected"])
        for e in q.events:
            self.assertIn("reason", e)

    def test_quick_reject_from_queued(self):
        q = TaskQueue()
        q.add("t1", "乙公司（虚构）", "数据分析师", AT1)
        q.transition("t1", "rejected", reason="不匹配", at=AT2)
        self.assertEqual(q.tasks["t1"]["status"], "rejected")

    def test_invalid_transition_queued_to_interviewing(self):
        q = TaskQueue()
        q.add("t1", "甲（虚构）", "算法", AT1)
        with self.assertRaises(QueueError):
            q.transition("t1", "interviewing", at=AT2)  # 跳过 following

    def test_rejected_terminal(self):
        q = TaskQueue()
        q.add("t1", "甲（虚构）", "算法", AT1)
        q.transition("t1", "rejected", at=AT2)
        with self.assertRaises(QueueError):
            q.transition("t1", "following", at=AT3)  # 终态封死

    def test_duplicate_task_rejected(self):
        q = TaskQueue()
        q.add("t1", "甲", "算法", AT1)
        with self.assertRaises(QueueError):
            q.add("t1", "甲", "算法", AT2)

    def test_events_append_only(self):
        q = TaskQueue()
        q.add("t1", "甲", "算法", AT1)
        before = q.export_events()
        q.transition("t1", "following", at=AT2)
        after = q.export_events()
        self.assertEqual(before, after[:len(before)])  # 只追加不丢失


if __name__ == "__main__":
    unittest.main(verbosity=2)
