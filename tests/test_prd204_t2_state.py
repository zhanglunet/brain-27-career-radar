# -*- coding: utf-8 -*-
"""PRD-204/T2 自测（trend #1021）：求职状态捕获与更新——事件到状态映射正确。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from job_state_memory import JobStateMemory, EVENT_STATUS_MAP  # noqa: E402


class TestEventToStatus(unittest.TestCase):
    def test_applied_to_submitted(self):
        m = JobStateMemory()
        r = m.record_event("示例公司A", "示例岗位", "applied", "2026-10-30T10:00:00Z")
        self.assertEqual(r["status"], "submitted")

    def test_rejected_to_rejected(self):
        m = JobStateMemory()
        m.record_event("示例公司A", "示例岗位", "applied", "t1")
        r = m.record_event("示例公司A", "示例岗位", "rejected", "t2")
        self.assertEqual(r["status"], "rejected")

    def test_interview_to_interviewing(self):
        m = JobStateMemory()
        m.record_event("示例公司A", "示例岗位", "applied", "t1")
        r = m.record_event("示例公司A", "示例岗位", "interview", "t2")
        self.assertEqual(r["status"], "interviewing")

    def test_event_history_preserved(self):
        m = JobStateMemory()
        m.record_event("示例公司A", "示例岗位", "applied", "t1")
        m.record_event("示例公司A", "示例岗位", "rejected", "t2")
        r = m.records["示例公司A::示例岗位"]
        self.assertEqual(len(r["events"]), 2)
        self.assertEqual(r["events"][0]["event"], "applied")
        self.assertEqual(r["events"][1]["event"], "rejected")

    def test_unknown_event_rejected(self):
        m = JobStateMemory()
        with self.assertRaises(ValueError):
            m.record_event("示例公司A", "示例岗位", "unknown_event", "t1")

    def test_get_active_filters_rejected(self):
        m = JobStateMemory()
        m.record_event("公司A", "岗位1", "applied", "t1")
        m.record_event("公司B", "岗位2", "applied", "t1")
        m.record_event("公司A", "岗位1", "rejected", "t2")
        active = m.get_active()
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["company"], "公司B")


if __name__ == "__main__":
    unittest.main()
