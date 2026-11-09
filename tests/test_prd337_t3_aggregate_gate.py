# -*- coding: utf-8 -*-
"""PRD-337/T3 测试（trend #1616 的 T3 环节）：公开信息聚合来源红线闸门。

运行：python3 -m unittest tests.test_prd337_t3_aggregate_gate -v（仓库根执行）

覆盖（T1 设计 §4/R1/R2/R4）：ERROR_CODES 三码封闭；source_gate 词表复核
（词表外拒绝）；entry_gate 三件套缺一拒绝（R2，兜底复核全条目）；
classify_blocked 三码归类计数；persist_gate（干净报告 allow/违例条目逐条
显形 reject/全部 blocked → allow_empty 一无所获也是如实结果零伪装/
schema 漂移拒绝）；与 T2 串联（真实 aggregate 产物直接过闸，含全 blocked
演练）。零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from aggregate_gate import (  # noqa: E402
    ERROR_CODES,
    entry_gate,
    persist_gate,
    source_gate,
    classify_blocked,
)
from public_info_aggregate import aggregate  # noqa: E402

NOW = "2026-11-10T09:00:00Z"
TARGET = {"kind": "company", "name": "公司 C-001（占位）"}


def _ok_fetch(target):
    return [{"url": "https://c001.example.invalid/news（占位）",
             "summary": "公开动态（占位）"}]


class TestCodes(unittest.TestCase):
    def test_three_codes_closed(self):
        self.assertEqual(set(ERROR_CODES),
                         {"SOURCE_BLOCKED", "SOURCE_UNREACHABLE",
                          "ENTRY_INCOMPLETE"})

    def test_source_gate_closed_vocab(self):
        self.assertTrue(source_gate("company_site"))
        self.assertFalse(source_gate("dark_web"))   # 词表外来源拒绝


class TestEntryGate(unittest.TestCase):
    def test_trio_missing_rejected(self):
        entry = {"source_id": "company_site",
                 "url": "https://x.example.invalid/a（占位）",
                 "captured_at": NOW}
        for key in ("source_id", "url", "captured_at"):
            broken = dict(entry)
            broken.pop(key)
            self.assertIn(key, entry_gate(broken), key)
            self.assertEqual(entry_gate(entry), [])   # 完整条目通过


class TestClassify(unittest.TestCase):
    def test_blocked_reasons_classified(self):
        report = {"blocked": [
            {"source_id": "public_job_page", "reason": "SOURCE_BLOCKED：反爬（占位）"},
            {"source_id": "public_event", "reason": "SOURCE_UNREACHABLE：不可达（占位）"},
            {"source_id": "company_site", "reason": "ENTRY_INCOMPLETE：缺 url（占位）"},
        ]}
        counts = classify_blocked(report)
        self.assertEqual(counts, {"SOURCE_BLOCKED": 1, "SOURCE_UNREACHABLE": 1,
                                  "ENTRY_INCOMPLETE": 1})


class TestPersistGate(unittest.TestCase):
    def test_clean_report_allowed(self):
        out = aggregate(TARGET, {"company_site": _ok_fetch}, now=NOW)
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "allow")
        self.assertEqual(gate["offending"], [])
        self.assertIn("批准门", gate["note"])

    def test_incomplete_entry_rejected_visibly(self):
        """R2 兜底：残缺条目混进 entries → 逐条显形拒绝落库。"""
        report = {"schema": "public-info-aggregate/v1",
                  "generated_at": NOW,
                  "entries": [{"source_id": "company_site", "url": "",
                               "captured_at": NOW}]}
        gate = persist_gate(report)
        self.assertEqual(gate["gate"], "reject")
        self.assertEqual(gate["offending"][0]["error_code"], "ENTRY_INCOMPLETE")

    def test_all_blocked_is_honest_empty_allow(self):
        """§4：全部 blocked → entries=[] 一无所获也是如实结果（零伪装）。"""
        def denied(target):
            raise RuntimeError("反爬拒绝（占位）")
        out = aggregate(TARGET, {"company_site": denied}, now=NOW)
        self.assertEqual(out["entries"], [])
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "allow_empty")
        self.assertGreaterEqual(gate["blocked_visible"], 1)
        self.assertIn("一无所获", gate["note"])

    def test_schema_drift_rejected(self):
        out = aggregate(TARGET, {"company_site": _ok_fetch}, now=NOW)
        out["schema"] = "public-info-aggregate/v2"
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "reject")
        self.assertTrue(any("钉值不符" in r for r in gate["reasons"]))


class TestChainWithT2(unittest.TestCase):
    def test_mixed_sources_full_chain(self):
        """与 T2 串联：一来源成功/一来源拒绝/一来源缺词表——闸门归类全显形。"""
        def partial(target):
            return [{"url": "https://e.example.invalid/1（占位）",
                     "summary": "公开演讲（占位）"},
                    {"summary": "缺 url 条目（占位）"}]   # 残缺条目 T2 已丢
        fetchers = {"company_site": _ok_fetch,
                    "public_job_page": partial,
                    "public_event": None}   # 未接来源（词表内跳过）
        out = aggregate(TARGET, fetchers, now=NOW)
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "allow")
        self.assertEqual(len(out["entries"]), 2)   # 两来源各一条完整条目
        self.assertEqual(gate["entries_checked"], 2)


class TestRedline(unittest.TestCase):
    def test_gate_module_zero_network_zero_credential_zero_delivery(self):
        """R3/R4：零网络零凭证符号零投递导入（AST 同表预埋）。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "selenium", "playwright", "smtp", "delivery", "apply"}
        src = (REPO / "lib" / "aggregate_gate.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)
        for token in ("cookie", "token", "password", "secret"):
            self.assertNotIn(token, src.lower().replace("token_types", ""))


if __name__ == "__main__":
    unittest.main()
