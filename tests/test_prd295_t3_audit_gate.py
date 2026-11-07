# -*- coding: utf-8 -*-
"""PRD-295/T3 测试（trend #1478）：求职记录审计与批准门不变闸门。

运行：python3 -m unittest tests.test_prd295_t3_audit_gate -v（仓库根执行）

覆盖（T1 设计 §5/§6/§7，验收「闸门有测试；批准门不变；审计可查」）：
① 审计 append-only 与 task_id 关联（成败都记含语法错）；② 批准门不变：
resolve_for_task 拒绝路径零 payload 产出零门接触、payload_for_gate 只读
投影白名单键越界即拒、refused 不产出 payload、AST 零 approval_dispatch
导入（模块对+本模块自检）；③ 错误码封闭穷举。零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from record_ref import ERROR_CODES as REF_CODES, resolve  # noqa: E402
from task_ref_audit import (  # noqa: E402
    ERROR_CODES,
    TaskRefAudit,
    payload_for_gate,
    resolve_for_task,
)

OPPS = [{"opportunity_id": "opp-2026-042（占位）", "company": "示例公司（占位）",
         "role": "算法工程师（占位）"}]
VERSIONS = [{"version": "v3", "profile": {"skills": ["python（占位）"]},
             "revoked": False}]


class 审计Tests(unittest.TestCase):
    def test_append_only_with_task_id(self):
        audit = TaskRefAudit()
        audit.log("@opp-2026-042（占位）",
                  resolve("@opp-2026-042（占位）", OPPS, VERSIONS),
                  at="2026-11-04T09:00:00Z", task_id="task-1（占位）")
        audit.log("@档案v2", None, at="2026-11-04T09:01:00Z", task_id="task-1（占位）")
        self.assertEqual([r["status"] for r in audit.records],
                         ["resolved", "refused"])              # 成败都记
        self.assertTrue(all(r["task_id"] == "task-1（占位）" for r in audit.records))

    def test_resolve_for_task_syntax_error_logged(self):
        audit = TaskRefAudit()
        out = resolve_for_task("@档案", OPPS, VERSIONS, at="2026-11-04T09:00:00Z",
                               task_id="task-1（占位）", audit=audit)
        self.assertTrue(out["refused"])
        self.assertEqual(out["error_code"], "REF_SYNTAX_ERROR")
        self.assertEqual(audit.records[-1]["error_code"], "REF_SYNTAX_ERROR")


class 批准门不变Tests(unittest.TestCase):
    def test_refused_never_produces_payload(self):
        audit = TaskRefAudit()
        out = resolve_for_task("@档案v9", OPPS, VERSIONS, at="2026-11-04T09:00:00Z",
                               task_id="task-1（占位）", audit=audit)
        self.assertTrue(out["refused"])
        with self.assertRaises(ValueError):
            payload_for_gate({"resolution": {"status": "refused"}})

    def test_payload_projection_readonly_whitelist(self):
        audit = TaskRefAudit()
        out = resolve_for_task("@opp-2026-042（占位）", OPPS, VERSIONS,
                               at="2026-11-04T09:00:00Z", task_id="task-1（占位）",
                               audit=audit)
        payload = payload_for_gate(out["resolution"])
        self.assertEqual(payload["opportunity_id"], "opp-2026-042（占位）")
        # 投影是只读的：改 payload 不影响解析产物
        payload["opportunity_id"] = "tampered（占位）"
        self.assertEqual(out["resolution"]["opportunity_id"], "opp-2026-042（占位）")

    def test_payload_key_boundary(self):
        leaked = {"opportunity_id": "opp-x（占位）", "extra_key": 1,
                  "resolution": {"status": "resolved"}}
        with self.assertRaises(ValueError):
            payload_for_gate(leaked)

    def test_ast_redline_module_pair(self):
        """R1：解析/审计两模块零 approval_dispatch 导入（批准门不变）。"""
        banned = {"approval_dispatch"}
        for name in ("record_ref.py", "task_ref_audit.py"):
            tree = ast.parse((REPO / "lib" / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                mods = []
                if isinstance(node, ast.Import):
                    mods = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mods = [node.module.split(".")[0]]
                for mod in mods:
                    self.assertNotIn(mod, banned, f"{name} 导入了 {mod}")


class 词表封闭Tests(unittest.TestCase):
    def test_merged_vocabulary(self):
        self.assertEqual(sorted(ERROR_CODES), sorted(REF_CODES))
        self.assertEqual(sorted(ERROR_CODES),
                         ["PROFILE_VERSION_GONE", "REF_AMBIGUOUS",
                          "REF_NOT_FOUND", "REF_SYNTAX_ERROR"])


if __name__ == "__main__":
    unittest.main()
