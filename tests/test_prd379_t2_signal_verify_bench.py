# -*- coding: utf-8 -*-
"""PRD-379/T2 测试（trend #1883 的 T2 环节）：机会信号验证台。

运行：python3 -m unittest tests.test_prd379_t2_signal_verify_bench -v
（仓库根执行）

覆盖（T1 §4 + R1~R4）：verify_signal 八件套校验（缺一 BENCH_INCOMPLETE）；
来源可复访+quote 回指双 match → VERIFIED / 任一不符 → UNVERIFIED（词表
封闭）；verify_signals 机会库入库包装（UNVERIFIED 拦下）；
SignalBenchLedger JSONL 真实落库+八件套缺一/词表外/REPRO_MISMATCH 声称
拒绝；reverify 语料变更二次验证（指纹不符 BENCH_STALE 拒绝复用/一致正常
复验）；AST 零 LLM 零网络零子进程零投递词面+语料指纹与 351 同族口径。
零网络（复访=对语料快照复算零真实外呼）；全合成占位 URL 一律
example.invalid。
"""
import ast
import json
import sys
import tempfile
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from signal_verify_bench import (  # noqa: E402
    BENCH_SCHEMA,
    ERROR_CODES,
    SignalBenchError,
    SignalBenchLedger,
    VERDICTS,
    corpus_fingerprint,
    verify_signal,
    verify_signals,
)

NOW = "2026-11-13T09:00:00Z"
CORPUS = [{"url": "https://o001.example.invalid/1（占位）",
           "text": "岗位：资深工程师（占位）"},]
SIGNAL = {"signal_id": "s-001", "kind": "job_opening",
          "source_url": "https://o001.example.invalid/1（占位）",
          "source_ref": "public-info-aggregate/v1#signals[0]（占位）",
          "quote": "资深工程师"}


def recheck_fn(corpus):
    """注入式来源复核判定（对语料快照复算，零真实外呼）：语料条目即信号。"""
    return [{"source_url": c.get("url")} for c in (corpus or [])]


class TestVerifySignal(unittest.TestCase):
    def test_verified_double_match(self):
        out = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["verdict"], "VERIFIED")
        self.assertTrue(out["reproduce"]["source_match"])
        self.assertTrue(out["reproduce"]["quote_match"])
        self.assertEqual(out["schema"], BENCH_SCHEMA)
        fp = corpus_fingerprint(CORPUS)
        self.assertTrue(fp.startswith("sha16:"))
        self.assertEqual(out["corpus_fingerprint"], fp)

    def test_unverified_when_source_not_in_corpus(self):
        out = verify_signal(dict(SIGNAL,
                                 source_url="https://x.example.invalid（占位）"),
                            CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["verdict"], "UNVERIFIED")
        self.assertFalse(out["reproduce"]["source_match"])

    def test_unverified_when_quote_missing(self):
        out = verify_signal(dict(SIGNAL, quote="不存在的引用（占位）"),
                            CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["verdict"], "UNVERIFIED")
        self.assertFalse(out["reproduce"]["quote_match"])

    def test_incomplete_refused(self):
        bad = dict(SIGNAL)
        del bad["quote"]
        out = verify_signal(bad, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["refused"], "BENCH_INCOMPLETE")
        out2 = verify_signal(SIGNAL, CORPUS, None, at=NOW)
        self.assertEqual(out2["refused"], "BENCH_INCOMPLETE")

    def test_verdict_vocab_closed(self):
        self.assertEqual(set(VERDICTS), {"VERIFIED", "UNVERIFIED"})


class TestVerifySignals(unittest.TestCase):
    def test_outlet_blocks_unverified(self):
        """机会库入库包装：UNVERIFIED 拦下不进机会库（R1）。"""
        signals = [SIGNAL, dict(SIGNAL, signal_id="s-002",
                                quote="不存在的引用（占位）")]
        out = verify_signals(signals, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(len(out["verified"]), 1)
        self.assertEqual(out["unverified_count"], 1)
        self.assertEqual(out["unverified"][0]["signal_id"], "s-002")


class TestSignalBenchLedger(unittest.TestCase):
    def test_jsonl_persistence_append_only(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "sbench" / "ledger.jsonl"
            led = SignalBenchLedger(path)
            led.record(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW),
                       at=NOW)
            led.record(verify_signal(dict(SIGNAL, signal_id="s-002"),
                                     CORPUS, recheck_fn, at=NOW), at=NOW)
            self.assertEqual(len(led.entries()), 2)
            lines = path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(json.loads(lines[0])["signal_id"], "s-001")

    def test_record_refusals(self):
        led = SignalBenchLedger(None)
        with self.assertRaisesRegex(SignalBenchError, "BENCH_INCOMPLETE"):
            led.record({"schema": BENCH_SCHEMA}, at=NOW)
        with self.assertRaisesRegex(SignalBenchError, "BENCH_REPRO_MISMATCH"):
            bad = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
            bad = dict(bad, verdict="VERIFIED",
                       reproduce={"source_match": True, "quote_match": False,
                                  "detail": "改（占位）"})
            led.record(bad, at=NOW)


class TestReverify(unittest.TestCase):
    def test_stale_refuses_reuse(self):
        """语料变更 → BENCH_STALE 拒绝复用旧 VERIFIED。"""
        led = SignalBenchLedger(None)
        led.record(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW),
                   at=NOW)
        new_corpus = [{"url": "https://o002.example.invalid（占位）",
                       "text": "其他岗位（占位）"}]
        out = led.reverify("s-001", new_corpus, recheck_fn, at=NOW)
        self.assertEqual(out["refused"], "BENCH_STALE")

    def test_same_corpus_reverify_ok(self):
        led = SignalBenchLedger(None)
        led.record(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW),
                   at=NOW)
        out = led.reverify("s-001", CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["verdict"], "VERIFIED")


class TestRedline(unittest.TestCase):
    def test_ast_zero_llm_zero_network_zero_apply(self):
        """AST：零 LLM 零网络零子进程零投递词面（复访=对语料快照复算，
        反爬拒绝显形零伪装红线不变）。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "openai", "anthropic", "approval_dispatch"}
        src = LIB / "signal_verify_bench.py"
        tree = ast.parse(src.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        self.assertFalse(imported & banned, imported & banned)
        names = {n.id.lower() for n in ast.walk(tree)
                 if isinstance(n, ast.Name)}
        names |= {n.attr.lower() for n in ast.walk(tree)
                  if isinstance(n, ast.Attribute)}
        for word in ("deliver", "apply(", "submit_application"):
            self.assertNotIn(word, names, f"出现投递词面 {word}")

    def test_error_codes_closed(self):
        self.assertEqual(set(ERROR_CODES),
                         {"BENCH_INCOMPLETE", "BENCH_REPRO_MISMATCH",
                          "BENCH_STALE"})


if __name__ == "__main__":
    unittest.main()
