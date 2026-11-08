# -*- coding: utf-8 -*-
"""PRD-323/T4+T5：重放闸门划界断言 + 验收试运行（trend #655 区段）。

T4 划界：lib/replay_gate.py 零网络形态（无 requests/urllib/socket/http）、
零写盘调用形态（AST import 白名单）+ 闸门拒绝零副作用（入参 deepcopy 不变）。
T5 验收：真实 T2（机会时间线渲染）→ verify → replay_gate 全链——
正常时间线过闸两遍逐字段一致（可重放）；非 dict/MISMATCH 拒绝口径可重放。
"""
import ast
import copy
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))
from opportunity_timeline import render_timeline
from replay_gate import replay_gate


class T4BoundaryTests(unittest.TestCase):
    def test_ast_import_stdlib_only(self):
        tree = ast.parse((REPO / "lib" / "replay_gate.py").read_text(encoding="utf-8"))
        roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                roots.add(node.module.split(".")[0])
        for bad in ("requests", "urllib", "socket", "http"):
            self.assertNotIn(bad, roots, f"越界网络导入：{bad}")

    def test_gate_refusal_zero_side_effect(self):
        verify = {"status": "MISMATCH", "evidence": {"ledger": 1}}
        frozen = copy.deepcopy(verify)
        out = replay_gate(verify)
        self.assertFalse(out["allow"])
        self.assertEqual(verify, frozen, "拒绝路径不得改入参")


class T5AcceptanceTests(unittest.TestCase):
    EVENTS = [
        {"created_at": "2026-11-08", "title": "岗位 A 更新", "status": "new"},
        {"created_at": "2026-11-07", "title": "岗位 B 截止提醒", "status": "applied"},
    ]

    def _chain(self, events):
        md = render_timeline(events)
        verify = {"status": "MATCH", "evidence": {"timeline": md, "count": len(events)}}
        return {"timeline": md, "verify": verify, "gate": replay_gate(verify)}

    def test_real_timeline_full_chain_replay_identical(self):
        out1 = self._chain(self.EVENTS)
        out2 = self._chain(self.EVENTS)
        self.assertEqual(out1, out2, "两遍逐字段一致（可重放口径）")
        self.assertTrue(out1["gate"]["allow"])
        self.assertIn("岗位 A 更新", out1["timeline"])

    def test_mismatch_refused_replay_identical(self):
        def run():
            return replay_gate({"status": "MISMATCH", "evidence": {"rerun": "不同"}})
        self.assertEqual(run(), run())
        self.assertFalse(run()["allow"])
        self.assertEqual(run()["code"], "REPLAY_GATE_REFUSED")

    def test_non_dict_refused(self):
        self.assertFalse(replay_gate("not-a-dict")["allow"])
        self.assertFalse(replay_gate(None)["allow"])


if __name__ == "__main__":
    unittest.main()
