# -*- coding: utf-8 -*-
"""PRD-232/T3 测试：多 agent 协作接入（trend #1162）。

运行：python3 -m unittest test_prd232_t3_agents -v（本目录）

覆盖（T1 §三，验收「协作任务可分配、执行、回收」）：三类分工任务分配→执行→
回收全链；产出落盘才算完成（引用缺失/落盘缺失 → failed + 摘要）；agent 不得
互相派活（suggest_task 待用户决定，不自动建单）；能力边界（requestApproval/
execute_delivery/transition_status 全员禁，越权 → agent_boundary_violation +
任务终止）；3 连败 degraded（自动派发停、手动放行）；失败不自动重试（新任务
新 id）；running 可 abandoned；事件 append-only；确定性。零网络；全合成。
"""
import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from workbench_agents import (  # noqa: E402
    AGENT_CAPABILITIES,
    BoundaryViolation,
    AgentBoardError,
    AgentTaskBoard,
)


def _board(exists=None) -> AgentTaskBoard:
    return AgentTaskBoard(exists_fn=exists)


def _run(board, task_id="t-1", kind="preparer", at="2026-11-08T10:00:00+08:00"):
    board.create_task(task_id, kind, "item-001", at=at)
    return board.dispatch(task_id, at=at)


class 分配执行回收Tests(unittest.TestCase):
    def test_full_lifecycle_assign_run_reclaim(self):
        """验收核心：分配（建单）→ 执行（派发）→ 回收（产出落盘校验过 → done）。"""
        board = _board(exists=lambda p: True)
        _run(board)
        task = board.complete_task("t-1", [
            {"kind": "materials", "path": "materials/占位-draft-v1.md"},
        ], at="2026-11-08T10:05:00+08:00")
        self.assertEqual(task["status"], "done")
        self.assertEqual(task["finished_at"], "2026-11-08T10:05:00+08:00")
        self.assertEqual(len(task["output_refs"]), 1)

    def test_output_not_on_disk_fails_with_summary(self):
        """产出落盘才算完成：路径不存在 → failed + failure_summary（不静默）。"""
        board = _board(exists=lambda p: False)
        _run(board)
        task = board.complete_task("t-1", [
            {"kind": "report", "path": "reports/占位-review.md"}], at="x")
        self.assertEqual(task["status"], "failed")
        self.assertIn("未落盘", task["failure_summary"])

    def test_invalid_ref_kind_fails(self):
        board = _board(exists=lambda p: True)
        _run(board)
        task = board.complete_task("t-1", [{"kind": "hacked", "path": "x"}], at="x")
        self.assertEqual(task["status"], "failed")
        self.assertIn("kind 非法", task["failure_summary"])

    def test_only_running_can_be_reclaimed(self):
        board = _board(exists=lambda p: True)
        board.create_task("t-1", "collector", "item-001", at="x")
        with self.assertRaises(AgentBoardError):
            board.complete_task("t-1", [], at="x")  # 尚未派发

    def test_three_agent_kinds_supported(self):
        """搜集/准备/复盘三类都可分配执行回收。"""
        board = _board(exists=lambda p: True)
        for index, kind in enumerate(("collector", "preparer", "reviewer")):
            task_id = f"t-{index}"
            board.create_task(task_id, kind, "item-001", at="x")
            board.dispatch(task_id, at="x")
            ref_kind = {"collector": "candidate_cache",
                        "preparer": "materials",
                        "reviewer": "report"}[kind]
            done = board.complete_task(task_id, [{"kind": ref_kind, "path": f"p/{index}"}],
                                       at="x")
            self.assertEqual(done["status"], "done")


class 不互相派活Tests(unittest.TestCase):
    def test_agent_suggestion_not_auto_created(self):
        """agent 只能写建议任务，工作台呈现待用户决定（不自动建单）。"""
        board = _board()
        board.suggest_task("reviewer", "item-001", "建议对 item-002 做同型复盘", at="x")
        self.assertEqual(len(board.suggestions), 1)
        self.assertEqual(board.suggestions[0]["status"], "pending_user_decision")
        self.assertEqual(board.tasks, {})  # 未自动建单（防失控链式调用）

    def test_unknown_kind_rejected(self):
        board = _board()
        with self.assertRaises(AgentBoardError):
            board.create_task("t-1", "hacker", "item-001", at="x")


class 能力边界Tests(unittest.TestCase):
    def test_approval_and_execute_forbidden_for_all(self):
        """总红线：任何 agent 无权投递、无权调用批准门任何接口（连 requestApproval 都不行）。"""
        for kind in AGENT_CAPABILITIES:
            board = _board()
            with self.assertRaises(BoundaryViolation):
                board.enforce_capability(kind, "request_approval")
            with self.assertRaises(BoundaryViolation):
                board.enforce_capability(kind, "execute_delivery")

    def test_capability_table_positive_paths(self):
        board = _board()
        board.enforce_capability("preparer", "write_materials_draft")  # 不抛
        board.enforce_capability("collector", "propose_enqueue")
        board.enforce_capability("reviewer", "write_review_report")
        with self.assertRaises(BoundaryViolation):
            board.enforce_capability("preparer", "write_review_report")  # 跨职责也越权

    def test_boundary_violation_terminates_task_with_event(self):
        """越权 → 任务立即终止 + agent_boundary_violation 事件（§3.3 G3 用例）。"""
        board = _board(exists=lambda p: True)
        _run(board)
        task = board.record_boundary_violation("t-1", "request_approval", at="x")
        self.assertEqual(task["status"], "failed")
        self.assertIn("agent_boundary_violation", task["failure_summary"])
        violations = [e for e in board.events if e["type"] == "agent_boundary_violation"]
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0]["action"], "request_approval")


class 失败与降级Tests(unittest.TestCase):
    def test_degraded_after_three_consecutive_failures(self):
        """3 连败 → degraded：自动派发停止、手动派发仍可（§3.3）。"""
        board = _board(exists=lambda p: False)
        for index in range(3):
            task_id = f"t-{index}"
            board.create_task(task_id, "preparer", "item-001", at="x", manual=True)
            board.dispatch(task_id, at="x")
            board.complete_task(task_id, [{"kind": "materials", "path": "ghost"}], at="x")
        self.assertTrue(board.degraded["preparer"])
        degraded_events = [e for e in board.events if e["type"] == "agent_degraded"]
        self.assertEqual(degraded_events[0]["consecutive_failures"], 3)
        with self.assertRaises(AgentBoardError):
            board.create_task("t-auto", "preparer", "item-001", at="x", manual=False)
        manual = board.create_task("t-manual", "preparer", "item-001", at="x", manual=True)
        self.assertEqual(manual["status"], "queued")

    def test_success_resets_failure_streak(self):
        board = _board(exists=lambda p: True)
        for index in range(2):
            board.create_task(f"f-{index}", "preparer", "item-001", at="x")
            board.dispatch(f"f-{index}", at="x")
            board.complete_task(f"f-{index}", [{"kind": "materials", "path": "ghost"}], at="x")
        board.create_task("ok-1", "preparer", "item-001", at="x")
        board.dispatch("ok-1", at="x")
        board.complete_task("ok-1", [{"kind": "materials", "path": "real"}], at="x")
        self.assertFalse(board.degraded["preparer"])  # 连败被成功清零

    def test_no_auto_retry_same_id_rejected(self):
        """失败不自动重试：旧任务不可复活，同 id 重建也拒绝（新任务新 id）。"""
        board = _board(exists=lambda p: False)
        board.create_task("t-1", "preparer", "item-001", at="x")
        board.dispatch("t-1", at="x")
        board.fail_task("t-1", "超时（占位摘要）", at="x")
        with self.assertRaises(AgentBoardError):
            board.dispatch("t-1", at="x")   # 终态不可复活
        with self.assertRaises(AgentBoardError):
            board.create_task("t-1", "preparer", "item-001", at="x")  # 同 id 重建拒绝

    def test_retry_with_new_id_works(self):
        board = _board(exists=lambda p: False)
        board.create_task("t-1", "preparer", "item-001", at="x")
        board.dispatch("t-1", at="x")
        board.fail_task("t-1", "超时（占位摘要）", at="x")
        retry = board.create_task("t-2", "preparer", "item-001", at="x", manual=True)
        self.assertEqual(retry["status"], "queued")

    def test_abandon_running_task(self):
        board = _board(exists=lambda p: True)
        _run(board)
        task = board.abandon_task("t-1", at="x", by="user")
        self.assertEqual(task["status"], "abandoned")
        with self.assertRaises(AgentBoardError):
            board.abandon_task("t-1", at="x")  # 不可二次终止


class 留痕与呈现Tests(unittest.TestCase):
    def test_events_append_only_and_ordered(self):
        board = _board(exists=lambda p: True)
        _run(board)
        board.complete_task("t-1", [{"kind": "materials", "path": "p"}], at="x")
        types = [e["type"] for e in board.events]
        self.assertEqual(types, ["task_created", "task_dispatched", "task_done"])
        self.assertEqual(len(board.events), 3)  # 只增不删

    def test_list_tasks_filters(self):
        board = _board(exists=lambda p: True)
        board.create_task("t-1", "collector", "item-001", at="x")
        board.create_task("t-2", "preparer", "item-001", at="x")
        self.assertEqual([t["task_id"] for t in board.list_tasks(agent_kind="preparer")],
                         ["t-2"])
        self.assertEqual(len(board.list_tasks()), 2)


if __name__ == "__main__":
    unittest.main()
