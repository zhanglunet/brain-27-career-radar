# -*- coding: utf-8 -*-
"""PRD-379/T4 测试（trend #1883 的 T4 环节）：机会信号验证台划界断言。

运行：python3 -m unittest tests.test_prd379_t4_signal_verify_bench_boundary -v
（仓库根执行）

覆盖（T1 §0/§3，验收「划界断言通过」）：
  ① 模块隔离双向：signal_verify_bench/gates 零导入 approval_inbox（365
    收件箱——下游零感知）/public_info_aggregate（337 信号来源——被消费
    零 import，经 recheck_fn 注入重跑）/opportunity_replay*（351 重放）/
    job_doc_snapshot（281 档案快照）/approval_dispatch（175 批准门）+
    借鉴词零出现（codex/security-audit，仅代码标识符扫描 docstring 提及
    不算）；
  ② 零外部仓内耦合钉值：bench 静态导入全标准库（gates 只 import 同链
    corpus_fingerprint）；零 LLM 零网络零子进程零投递词面 AST（R2/反爬
    拒绝显形零伪装红线不变）；
  ③ R2 零新增信号 AST+行为：bench 零聚合/复核词面（aggregate 不在标识符
    面）——复算只经注入 fn；同一输入 verify_signal 两遍逐字节一致（确定
    性复现）；
  ④ R1 拦截行为钉值：UNVERIFIED 不进 verified 分组（不进机会库）；
  ⑤ R3 八件套封闭钉值：缺件 BENCH_INCOMPLETE+verdict 词表封闭+语料指纹
    与 351 snapshot_digest 同族口径钉值；
  ⑥ R4：SignalBenchLedger 公开方法面封闭+reverify BENCH_STALE；
  ⑦ §3 划界钉值：public_info_aggregate 面（aggregate）与 approval_inbox
    面（ITEM_KINDS 词表）符号不变——信号产出归聚合层、验证台零新增信号，
    互不越界。
零网络；全合成占位 URL 一律 example.invalid。
"""
import ast
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from approval_inbox import ITEM_KINDS  # noqa: E402
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
           "text": "岗位：资深工程师（占位）"}]
SIGNAL = {"signal_id": "s-001", "kind": "job_opening",
          "source_url": "https://o001.example.invalid/1（占位）",
          "source_ref": "public-info-aggregate/v1#signals[0]（占位）",
          "quote": "资深工程师"}

BENCH_MODULES = ["signal_verify_bench.py", "signal_verify_bench_gates.py"]


def recheck_fn(corpus):
    return [{"source_url": c.get("url")} for c in (corpus or [])]


def _imports_of(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    return imported


def _code_names(path: Path) -> set:
    """仅代码标识符（ast.Name/Attribute）——docstring 提及不算引用。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
    return names


class TestModuleIsolation(unittest.TestCase):
    def test_bench_never_imports_inbox_aggregate_replay_or_gate(self):
        """验证台面零触碰收件箱/聚合/重放/档案快照/批准门（信号来源经注入
        重跑零 import；收件箱是下游零感知）。"""
        for mod in BENCH_MODULES:
            imported = _imports_of(LIB / mod)
            for banned in ("approval_inbox", "public_info_aggregate",
                           "opportunity_replay", "opportunity_replay_gates",
                           "job_doc_snapshot", "approval_dispatch"):
                self.assertNotIn(banned, imported, f"{mod} 导入 {banned}")
            names = _code_names(LIB / mod)
            for symbol in ("InboxLedger", "aggregate", "make_pack",
                           "state_snapshot", "GateDenied"):
                self.assertNotIn(symbol, names, f"{mod} 引用 {symbol}")

    def test_inbox_never_imports_bench(self):
        """收件箱面零导入验证台（365 不感知本条——双向隔离）。"""
        imported = _imports_of(LIB / "approval_inbox.py")
        for mod in ("signal_verify_bench", "signal_verify_bench_gates"):
            self.assertNotIn(mod, imported)

    def test_upstream_zero_symbols(self):
        """借鉴仓（codex-security Apache-2.0/security-audit-skill MIT 实测）
        零符号——只借控制面形态（仅代码标识符扫描）。"""
        for mod in BENCH_MODULES:
            names = {n.lower() for n in _code_names(LIB / mod)}
            for word in ("codex", "audit_skill"):
                self.assertNotIn(word, names, f"{mod} 出现 {word}")

    def test_zero_internal_coupling_and_redline_ast(self):
        """零外部仓内耦合钉值：bench 静态导入全标准库（gates 只 import 同链
        corpus_fingerprint）；零 LLM 零网络零子进程零投递词面。"""
        imported = _imports_of(LIB / "signal_verify_bench.py")
        self.assertLessEqual(imported - {"__future__", "copy", "hashlib",
                                         "json", "pathlib", "typing"},
                             set(), imported)
        gates_imported = _imports_of(LIB / "signal_verify_bench_gates.py")
        self.assertLessEqual(gates_imported - {"__future__", "typing",
                                               "signal_verify_bench"},
                             set())
        for mod in BENCH_MODULES:
            names = {n.lower() for n in _code_names(LIB / mod)}
            for word in ("deliver", "submit_application"):
                self.assertNotIn(word, names, f"{mod} 出现 {word}")


class TestRedLinePins(unittest.TestCase):
    def test_r2_no_new_signal_ast_and_deterministic(self):
        """R2 AST+行为：bench 零聚合/复核词面（复算只经注入 fn）；同一输入
        verify_signal 两遍逐字节一致（确定性复现）。"""
        for mod in BENCH_MODULES:
            names = {n.lower() for n in _code_names(LIB / mod)}
            for word in ("aggregate",):
                self.assertNotIn(word, names, f"{mod} 出现 {word}")
        a = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        b = verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW)
        self.assertEqual(a, b)

    def test_r1_unverified_blocked_at_outlet(self):
        """R1 拦截钉值：UNVERIFIED 不进 verified 分组（不进机会库）。"""
        out = verify_signals([dict(SIGNAL, quote="不存在的引用（占位）")],
                             CORPUS, recheck_fn, at=NOW)
        self.assertEqual(out["verified"], [])
        self.assertEqual(out["unverified_count"], 1)

    def test_r3_eight_piece_closed_and_corpus_fp_family(self):
        """R3 钉值：账目缺件 BENCH_INCOMPLETE；verdict 词表封闭；语料指纹
        与 351 snapshot_digest 同族口径（sha16: 前缀确定性）。"""
        led = SignalBenchLedger(None)
        with self.assertRaisesRegex(SignalBenchError, "BENCH_INCOMPLETE"):
            led.record({"schema": BENCH_SCHEMA}, at=NOW)
        self.assertEqual(set(VERDICTS), {"VERIFIED", "UNVERIFIED"})
        fp = corpus_fingerprint(CORPUS)
        self.assertTrue(fp.startswith("sha16:"))
        self.assertEqual(fp, corpus_fingerprint(CORPUS))

    def test_r4_ledger_surface_closed_and_stale(self):
        """R4：SignalBenchLedger 公开方法面封闭（零删除方法）+reverify
        语料变更 BENCH_STALE 拒绝复用。"""
        led = SignalBenchLedger(None)
        methods = {n for n in dir(led) if not n.startswith("_")}
        self.assertLessEqual(methods, {"record", "entries", "latest_for",
                                       "reverify"}, methods)
        led.record(verify_signal(SIGNAL, CORPUS, recheck_fn, at=NOW), at=NOW)
        out = led.reverify("s-001", [{"url": "https://x.example.invalid（占位）",
                                      "text": "其他（占位）"}], recheck_fn,
                           at=NOW)
        self.assertEqual(out["refused"], "BENCH_STALE")


class TestDemarcationPins(unittest.TestCase):
    def test_aggregate_and_inbox_surfaces_unchanged(self):
        """§3 划界钉值：public_info_aggregate 面（aggregate）与
        approval_inbox 面（ITEM_KINDS 词表）符号不变——信号产出归聚合层、
        验证台零新增信号，互不越界。"""
        import public_info_aggregate as pia
        import approval_inbox as ai
        self.assertTrue(callable(pia.aggregate))
        self.assertEqual(set(ITEM_KINDS),
                         {"delivery_approval", "ref_disambiguation",
                          "profile_draft_confirm"})
        self.assertFalse(hasattr(pia, "verify_signal"),
                         "聚合面不应出现验证台符号")
        self.assertFalse(hasattr(ai, "reverify"),
                         "收件箱面不应出现复验符号")


if __name__ == "__main__":
    unittest.main()
