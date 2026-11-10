# -*- coding: utf-8 -*-
"""PRD-337/T2 测试（trend #1616 的 T2 环节）：公开信息聚合最小实现。

运行：python3 -m unittest tests.test_prd337_t2_aggregate -v（仓库根执行）

覆盖（T1 设计 §3.1/§3.2/§3.3/§4）：来源词表封闭四项（R1）；一键聚合逐来源
注入式 fetch；条目三件套齐备入 entries（缺 url/summary 丢弃显形）；单来源
失败 blocked[] 显形不重试不伪装（R3）；全部 blocked → entries=[] 一无所获
也是如实结果；零推理零投递（AST 红线：零批准门/零投递符号）；确定性。
零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from public_info_aggregate import (  # noqa: E402
    SOURCE_VOCAB,
    aggregate,
)

TARGET = {"kind": "company", "name": "公司 C-001（占位）"}
NOW = "2026-11-09T09:00:00Z"


def fetchers_ok():
    def job_fetch(target):
        return [{"url": "https://jobs.example.invalid/1（占位）",
                 "summary": "在招：算法工程师（占位）"}]
    def site_fetch(target):
        raise RuntimeError("反爬拒绝（占位）")
    return {"public_job_page": job_fetch, "company_site": site_fetch}


class Test词表封闭Tests(unittest.TestCase):
    def test_vocab_four_closed(self):
        self.assertEqual(sorted(SOURCE_VOCAB),
                         ["company_site", "public_academic", "public_event",
                          "public_job_page"])


class 聚合Tests(unittest.TestCase):
    def test_full_aggregate_with_blocked_visible(self):
        """R3：单来源反爬拒绝 → blocked[] 显形不重试不伪装；其余来源照常。"""
        fetchers = fetchers_ok()
        out = aggregate(TARGET, fetchers, now=NOW)
        self.assertEqual(len(out["entries"]), 1)
        self.assertEqual(len(out["blocked"]), 1)
        self.assertIn("反爬拒绝", out["blocked"][0]["reason"])
        self.assertIn("背景参考", out["note"])

    def test_entry_three_keys_required(self):
        """R2：条目缺 url/summary → 丢弃显形不落库。"""
        bad = {"public_job_page": lambda t: [{"summary": "只有摘要（占位）"}]}
        out = aggregate(TARGET, bad, now=NOW)
        self.assertEqual(out["entries"], [])
        self.assertTrue(any("ENTRY_INCOMPLETE" in b["reason"]
                            for b in out["blocked"]))

    def test_all_blocked_still_honest_report(self):
        """全部来源失败 → entries=[] 但报告如实产出（一无所获也是结果）。"""
        def always_fail(target):
            raise RuntimeError("网络不可达（占位）")
        fetchers = {sid: always_fail for sid in SOURCE_VOCAB}
        out = aggregate(TARGET, fetchers, now=NOW)
        self.assertEqual(out["entries"], [])
        self.assertEqual(len(out["blocked"]), len(SOURCE_VOCAB))


class 红线Tests(unittest.TestCase):
    def test_ast_no_gate_no_delivery(self):
        """R4：聚合模块零批准门/零投递符号（本条只采集零动作）。"""
        banned = {"approval_dispatch", "approval_queue", "task_queue"}
        tree = ast.parse((REPO / "lib" / "public_info_aggregate.py")
                         .read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)
            if isinstance(node, ast.Name):
                for token in ("dispatch_delivery", "submit_application",
                              "email_send"):
                    self.assertNotEqual(node.id, token)

    def test_zero_credentials(self):
        """R3：采集器接口零凭证注入符号。"""
        src = (REPO / "lib" / "public_info_aggregate.py").read_text(encoding="utf-8")
        for token in ("cookie", "token", "password", "authorization"):
            self.assertNotIn(token.lower(), src.lower(), token)

    def test_deterministic(self):
        fetchers = fetchers_ok()
        first = aggregate(TARGET, fetchers, now=NOW)
        second = aggregate(TARGET, fetchers, now=NOW)
        self.assertEqual(
            (first["entries"], first["blocked"]), (second["entries"], second["blocked"]))


if __name__ == "__main__":
    unittest.main()
