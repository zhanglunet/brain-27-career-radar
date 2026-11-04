# -*- coding: utf-8 -*-
"""PRD-295/T2 测试（trend #1477）：@机会/@档案引用解析最小实现。

运行：python3 -m unittest tests.test_prd295_t2_record_ref -v（仓库根执行）

覆盖（T1 设计 §3/§4/§5/§6，验收「样例可解析到确定 id，审计可查，有测试」）：
  parse 两形态与禁止形态（档案缺版本/相对词/节锚/双写）；resolve 精确匹配→
  确定 id、候选 0/多裁决、PROFILE_VERSION_GONE 不猜就近版、meta_summary
  摘要指纹零全文；批准门不变 AST 红线（零 approval_dispatch 执行导入）；
  RefAudit append-only 成败都记。
零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from record_ref import (  # noqa: E402
    RefAudit,
    RefSyntaxError,
    parse,
    resolve,
)

OPPS = [{"opportunity_id": "opp-2026-042（占位）", "company": "示例公司（占位）",
         "role": "算法工程师（占位）"}]
VERSIONS = [
    {"version": "v3", "profile": {"skills": ["python（占位）"]}, "revoked": False},
    {"version": "v2", "profile": {"skills": []}, "revoked": True},
]


class TestParse(unittest.TestCase):
    def test_two_forms(self):
        self.assertEqual(parse("@opp-2026-042（占位）"),
                         {"kind": "opportunity", "opportunity_id": "opp-2026-042（占位）",
                          "version": None})
        self.assertEqual(parse("@档案v3"),
                         {"kind": "profile", "opportunity_id": None, "version": "v3"})

    def test_prohibited_forms(self):
        for bad in ("@档案", "@最新机会", "@当前档案", "@机会-2026-042（占位）#岗位",
                    "@@双写", "@机会-042 额外"):
            with self.assertRaises(RefSyntaxError):
                parse(bad)


class TestResolve(unittest.TestCase):
    def test_opportunity_resolves_to_id(self):
        out = resolve("@opp-2026-042（占位）", OPPS, VERSIONS)
        self.assertEqual(out["resolution"]["status"], "resolved")
        self.assertEqual(out["opportunity_id"], "opp-2026-042（占位）")
        self.assertEqual(out["meta_summary"]["company"], "示例公司（占位）")

    def test_profile_resolves_with_digest_zero_fulltext(self):
        out = resolve("@档案v3", OPPS, VERSIONS)
        self.assertEqual(out["profile_version"], "v3")
        digest = out["meta_summary"]["profile_digest"]
        self.assertTrue(digest.startswith("sha16:"))
        self.assertNotIn("python", str(out["meta_summary"]))     # 全文零搬运

    def test_revoked_version_gone_no_guess(self):
        out = resolve("@档案v2", OPPS, VERSIONS)
        self.assertEqual(out["resolution"]["error_code"], "PROFILE_VERSION_GONE")
        self.assertIn("不猜", out["resolution"]["detail"])

    def test_not_found_and_ambiguous(self):
        out = resolve("@opp-不存在", OPPS, VERSIONS)
        self.assertEqual(out["resolution"]["error_code"], "REF_NOT_FOUND")
        dup = VERSIONS + [{"version": "v3", "profile": {}, "revoked": False}]
        out2 = resolve("@档案v3", OPPS, dup)
        self.assertEqual(out2["resolution"]["error_code"], "REF_AMBIGUOUS")

    def test_ast_redline_no_dispatch_execution(self):
        """R1：解析器模块零 approval_dispatch 执行方法导入（批准门不变）。"""
        banned = {"approval_dispatch"}
        tree = ast.parse((REPO / "lib" / "record_ref.py").read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)


class TestRefAudit(unittest.TestCase):
    def test_success_and_refusal_logged(self):
        audit = RefAudit()
        audit.resolve_logged("@opp-2026-042（占位）", OPPS, VERSIONS,
                             at="2026-11-04T09:00:00Z")
        audit.resolve_logged("@档案v2", OPPS, VERSIONS, at="2026-11-04T09:01:00Z")
        audit.resolve_logged("@档案", OPPS, VERSIONS, at="2026-11-04T09:02:00Z")
        self.assertEqual(
            [(r["status"], r.get("error_code")) for r in audit.records],
            [("resolved", None), ("refused", "PROFILE_VERSION_GONE"),
             ("refused", "REF_SYNTAX_ERROR")])               # 成败都记

    def test_append_only(self):
        audit = RefAudit()
        audit.resolve_logged("@档案v3", OPPS, VERSIONS, at="2026-11-04T09:00:00Z")
        before = list(audit.records)
        audit.resolve_logged("@档案v2", OPPS, VERSIONS, at="2026-11-04T09:01:00Z")
        self.assertEqual(audit.records[:len(before)], before)


if __name__ == "__main__":
    unittest.main()
