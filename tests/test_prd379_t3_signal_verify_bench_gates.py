# -*- coding: utf-8 -*-
"""PRD-379/T3 测试（trend #1883 的 T3 环节）：机会信号验证台闸门。

运行：python3 -m unittest tests.test_prd379_t3_signal_verify_bench_gates -v
（仓库根执行）

覆盖（T1 §5 + R1/R3/R4）：append_only_gate（无基线形态过/mark_baseline 后
追加 pass/删除或首条改写 LEDGER_DRIFT 显形/非账本对象显形）；verdict_gate
（一致 pass/双向不一致 BENCH_REPRO_MISMATCH/缺件词表外 BENCH_INCOMPLETE
显形）；stale_gate（指纹一致 pass/不符 BENCH_STALE 显形）；gate_summary
一票否决；与 T2 串联（真实 verify_signal+SignalBenchLedger 产物过闸全
pass）；ERROR_CODES 随模块导出；AST 零 LLM 零网络零投递词面+闸门只读。
零网络；全合成占位 URL 一律 example.invalid。
"""
import ast
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from signal_verify_bench import SignalBenchLedger, verify_signal  # noqa: E402
from signal_verify_bench_gates import (  # noqa: E402
    ERROR_CODES,
    append_only_gate,
    gate_summary,
    mark_baseline,
    stale_gate,
    verdict_gate,
)

NOW = "2026-11-13T09:00:00Z"
CORPUS = [{"url": "https://o001.example.invalid/1（占位）",
           "text": "岗位：资深工程师（占位）"}]
SIGNAL = {"signal_id": "s-001", "kind": "job_opening",
          "source_url": "https://o001.example.invalid/1（占位）",
          "source_ref": "public-info-aggregate/v1#signals[0]（占位）",
          "quote": "资深工程师"}


def recheck_fn(corpus):
    return [{"source_url": c.get("url")} for c in (corpus or [])]


def _ledger():
    led = SignalBenchLedger(None)
    led.record(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW), at=NOW)
    led.record(verify_signal(dict(SIGNAL, signal_id="s-002"), CORPUS,
                             recheck_fn, at=NOW), at=NOW)
    return led


class TestAppendOnlyGate(unittest.TestCase):
    def test_no_baseline_form_check_passes(self):
        self.assertEqual(append_only_gate(_ledger())["gate"], "pass")

    def test_mark_baseline_then_append_passes(self):
        led = _ledger()
        mark_baseline(led)
        led.record(verify_signal(dict(SIGNAL, signal_id="s-003"), CORPUS,
                                 recheck_fn, at=NOW), at=NOW)
        self.assertEqual(append_only_gate(led)["gate"], "pass")

    def test_deletion_detected(self):
        led = _ledger()
        mark_baseline(led)
        led._records.pop()
        self.assertEqual(append_only_gate(led)["gate"], "LEDGER_DRIFT")

    def test_first_record_rewrite_detected(self):
        led = _ledger()
        mark_baseline(led)
        led._records[0]["verdict"] = "UNVERIFIED"
        self.assertEqual(append_only_gate(led)["gate"], "LEDGER_DRIFT")

    def test_non_ledger_object_visible(self):
        self.assertEqual(append_only_gate(object())["gate"], "LEDGER_DRIFT")


class TestVerdictGate(unittest.TestCase):
    def test_consistent_record_passes(self):
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(verdict_gate(rec)["gate"], "pass")

    def test_verified_but_partial_mismatch(self):
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        rec["reproduce"]["quote_match"] = False
        self.assertEqual(verdict_gate(rec)["gate"], "BENCH_REPRO_MISMATCH")

    def test_unverified_but_double_match_mismatch(self):
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        rec["verdict"] = "UNVERIFIED"   # 词表内但与双 match 不一致
        self.assertEqual(verdict_gate(rec)["gate"], "BENCH_REPRO_MISMATCH")

    def test_vocab_out_and_missing_visible(self):
        rec = dict(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW),
                   verdict="MAYBE（占位）")
        self.assertEqual(verdict_gate(rec)["gate"], "BENCH_INCOMPLETE")
        out = verdict_gate({"signal_id": "x"})
        self.assertEqual(out["gate"], "BENCH_INCOMPLETE")
        self.assertTrue(any("缺" in r for r in out["reasons"]))


class TestStaleGate(unittest.TestCase):
    def test_matching_fingerprint_passes(self):
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(stale_gate(rec, CORPUS)["gate"], "pass")

    def test_stale_fingerprint_visible(self):
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        out = stale_gate(rec, [{"url": "https://o002.example.invalid（占位）",
                                "text": "其他（占位）"}])
        self.assertEqual(out["gate"], "BENCH_STALE")


class TestSummaryAndChain(unittest.TestCase):
    def test_summary_one_block_votes_all(self):
        led = _ledger()
        led.record(verify_signal(dict(SIGNAL, signal_id="s-003"), CORPUS,
                                 recheck_fn, at=NOW), at=NOW)
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        rec["reproduce"]["quote_match"] = False
        out = gate_summary([append_only_gate(led), verdict_gate(rec)])
        self.assertEqual(out["gate"], "block")
        self.assertEqual(out["gates_checked"], 2)

    def test_chain_with_real_t2_products(self):
        """与 T2 串联：真实 verify_signal+SignalBenchLedger 产物过闸全
        pass。"""
        led = _ledger()
        mark_baseline(led)
        rec = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        results = [append_only_gate(led), verdict_gate(rec),
                   stale_gate(rec, CORPUS)]
        self.assertTrue(all(r["gate"] == "pass" for r in results))
        self.assertEqual(gate_summary(results)["gate"], "pass")

    def test_error_codes_closed_and_exported(self):
        import signal_verify_bench_gates as g
        self.assertEqual(set(g.ERROR_CODES),
                         {"LEDGER_DRIFT", "BENCH_INCOMPLETE",
                          "BENCH_REPRO_MISMATCH", "BENCH_STALE"})


class TestRedline(unittest.TestCase):
    def test_ast_zero_llm_zero_network_zero_apply_readonly(self):
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "openai", "anthropic", "approval_dispatch"}
        src = LIB / "signal_verify_bench_gates.py"
        tree = ast.parse(src.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        self.assertFalse(imported & banned, imported & banned)
        text = src.read_text(encoding="utf-8")
        for call in (".record(", ".append("):
            self.assertNotIn(call, text, f"闸门出现账本写调用 {call}")
        names = {n.id.lower() for n in ast.walk(tree)
                 if isinstance(n, ast.Name)}
        for word in ("deliver", "submit_application"):
            self.assertNotIn(word, names, f"出现投递词面 {word}")


if __name__ == "__main__":
    unittest.main()
