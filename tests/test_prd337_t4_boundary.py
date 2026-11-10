# -*- coding: utf-8 -*-
"""PRD-337/T4 测试（trend #1616 的 T4 环节）：公开信息聚合划界断言。

运行：python3 -m unittest tests.test_prd337_t4_boundary -v（仓库根执行）

覆盖（T1 §0 R1/R2/R3/R4 + §2 划界）：R1 词表封闭穷举断言（四来源逐字钉值
——登录/付费/私享来源不在词表）；R3 零凭证（两模块 AST 零 cookie/token/
password/secret 符号 + 零伪装重试符号 retry/backoff + 零 selenium/playwright
爬虫绕过导入）；R4 零投递能力（零 smtp/delivery/apply 符号——求职动作走
PRD-175 批准门行为钉值 note 逐字）；R2 复钉（报告 entries 逐条三件套在位
——闸门兜底之上再核）；模块隔离（aggregate/gate 互不写对方状态——gate 只
读复核前后报告原样）；与 PRD-295 划界（零协作/派活/批准门导入）。零网络；
全合成占位。
"""
import ast
import copy
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from aggregate_gate import persist_gate  # noqa: E402
from public_info_aggregate import (  # noqa: E402
    AGG_SCHEMA,
    SOURCE_VOCAB,
    aggregate,
)

MODULES = ("public_info_aggregate.py", "aggregate_gate.py")
NOW = "2026-11-10T09:00:00Z"
TARGET = {"kind": "company", "name": "公司 C-001（占位）"}


def _ok(target):
    return [{"url": "https://c001.example.invalid/a（占位）",
             "summary": "公开动态（占位）"}]


class TestR1ClosedVocab(unittest.TestCase):
    def test_source_vocab_nailed_four(self):
        """R1 词表封闭穷举：四来源逐字钉值——登录/付费/私享来源不在词表。"""
        assert SOURCE_VOCAB == ("company_site", "public_job_page",
                                "public_event", "public_academic")
        for banned in ("internal_wiki", "paid_db", "private_group"):
            assert banned not in SOURCE_VOCAB


class TestR3ZeroCredential(unittest.TestCase):
    def test_zero_credential_symbols(self):
        """R3 AST：零 cookie/token/password/secret 凭证符号（T4 预埋落地）。"""
        for name in MODULES:
            src = (REPO / "lib" / name).read_text(encoding="utf-8").lower()
            for token in ("cookie", "token", "password", "secret",
                          "authorization", "session_id"):
                assert token not in src, f"{name} 出现凭证符号 {token}"

    def test_zero_crawler_bypass_zero_retry_disguise(self):
        """R3：零爬虫绕过导入（selenium/playwright）；零伪装重试符号。"""
        banned_imports = {"selenium", "playwright", "scrapy", "curl_cffi",
                          "urllib", "requests", "socket", "http",
                          "subprocess"}
        for name in MODULES:
            src = (REPO / "lib" / name).read_text(encoding="utf-8")
            tree = ast.parse(src)
            for node in ast.walk(tree):
                mods = []
                if isinstance(node, ast.Import):
                    mods = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mods = [node.module.split(".")[0]]
                for mod in mods:
                    assert mod not in banned_imports, f"{name} 导入 {mod}"
            low = src.lower()
            for token in ("retry", "backoff", "spoof", "disguise"):
                assert token not in low, f"{name} 出现伪装重试符号 {token}"


class TestR4ZeroDelivery(unittest.TestCase):
    def test_zero_delivery_symbols(self):
        """R4：零投递能力——零 smtp/delivery/apply 符号（求职动作走批准门）。"""
        for name in MODULES:
            src = (REPO / "lib" / name).read_text(encoding="utf-8").lower()
            for token in ("smtp", "sendmail", "delivery", "apply(", "submit("):
                assert token not in src, f"{name} 出现投递符号 {token}"

    def test_note_approval_gate_nailed(self):
        """PRD-175 行为钉值：报告 note 逐字含批准门划界（R4）。"""
        out = aggregate(TARGET, {"company_site": _ok}, now=NOW)
        assert "批准门" in out["note"]
        assert "零投递" in out["note"]


class TestR2AndIsolation(unittest.TestCase):
    def test_entries_trio_recheck(self):
        """R2 复钉：报告 entries 逐条 {source_id, url, captured_at} 在位。"""
        out = aggregate(TARGET, {"company_site": _ok}, now=NOW)
        assert out["schema"] == AGG_SCHEMA
        for e in out["entries"]:
            assert e["source_id"] and e["url"] and e["captured_at"] == NOW

    def test_gate_readonly_over_report(self):
        """闸门只读：persist_gate 前后报告原样（零写入）。"""
        out = aggregate(TARGET, {"company_site": _ok}, now=NOW)
        before = copy.deepcopy(out)
        persist_gate(out)
        assert out == before

    def test_no_collab_dispatch_imports(self):
        """与 PRD-295 划界：聚合模块零协作/派活/批准门模块导入。"""
        banned = {"collaboration", "task_dispatch", "approval_gate",
                  "job_apply"}
        for name in MODULES:
            tree = ast.parse((REPO / "lib" / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                mods = []
                if isinstance(node, ast.Import):
                    mods = [a.name.split(".")[0] for a in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    mods = [node.module.split(".")[0]]
                for mod in mods:
                    assert mod not in banned, f"{name} 导入 {mod}"


if __name__ == "__main__":
    unittest.main()
