# -*- coding: utf-8 -*-
"""PRD-351/T4 测试（trend #1630 的 T4 环节）：机会评估重放划界断言。

运行：python3 -m unittest tests.test_prd351_t4_opportunity_replay_boundary -v
（仓库根执行）

覆盖（T1 §0/§2，验收「划界断言通过」）：
  ① 模块隔离双向：opportunity_replay/gates 零导入 job_doc_snapshot
    （PRD-281 档案回滚）/authenticity（PRD-176 真实性复核）/
    approval_dispatch（PRD-175 批准门——门不变不感知）+ 借鉴词零出现
    （AiSOC/OpenBot MIT 只借形态）；job_doc_snapshot 零导入
    opportunity_replay*；
  ② 唯一耦合钉值：opportunity_replay 静态导入全标准库——评估层经
    eval_fn 注入（与 337 aggregate 同链但零 import，注入式钉值）；零网络
    零子进程零投递词面 AST（R2，与 PRD-337/T4 同表）；
  ③ R1 行为钉值：评估缺 opportunity_id/score/weights/why 任一或空 →
    refused=PACK_INCOMPLETE；
  ④ R2 零投递行为钉值：eval_fn 收到深拷贝（snapshots 零污染）+重放返回
    值零投递载荷键；
  ⑤ R3 零静默钉值：mismatch 键面封闭 {schema,refused,verdict,evidence,
    rerun_count}——零回退新推荐载荷键；
  ⑥ R4：ReplayLedger 方法面封闭（零删除方法）；
  ⑦ §2 划界钉值：job_doc_snapshot 快照面（state_snapshot+
    snapshot_digest）符号不变——PRD-281 管档案可逆，本条管评估可重算，
    互不越界。
零网络；示例 URL 全 example.invalid 占位。
"""
import ast
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from opportunity_replay import (  # noqa: E402
    ReplayLedger,
    make_pack,
    replay,
)
from job_doc_snapshot import snapshot_digest as doc_snapshot_digest  # noqa: E402

SNAPSHOTS = [{"opportunity_id": "O-001（占位）", "title": "岗位（占位）",
              "url": "https://o001.example.invalid/1（占位）"}]
EVALS = [{"opportunity_id": "O-001（占位）", "score": 78,
          "weights": {"技能匹配": 0.6}, "why": "技能匹配度高（占位）"}]

REPLAY_MODULES = ["opportunity_replay.py", "opportunity_replay_gates.py"]


def eval_fn(snapshots):
    return [dict(e) for e in EVALS]


def _imports_of(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    return imported


class TestModuleIsolation(unittest.TestCase):
    def test_replay_never_imports_snapshot_authenticity_or_gate(self):
        """重放面零触碰档案快照/真实性复核/批准门（评估可重算不感知可逆、
        独立复核与投递拦截——门不变）。"""
        for mod in REPLAY_MODULES:
            imported = _imports_of(LIB / mod)
            for banned in ("job_doc_snapshot", "authenticity",
                           "approval_dispatch", "public_info_aggregate"):
                self.assertNotIn(banned, imported, f"{mod} 导入 {banned}")
            blob = ast.dump(ast.parse(
                (LIB / mod).read_text(encoding="utf-8")))
            for symbol in ("state_snapshot", "doc_context", "GateDenied"):
                self.assertNotIn(symbol, blob, f"{mod} 引用 {symbol}")

    def test_snapshot_never_imports_replay(self):
        """快照面零导入重放（PRD-281 不感知本条——双向隔离）。"""
        imported = _imports_of(LIB / "job_doc_snapshot.py")
        for mod in ("opportunity_replay", "opportunity_replay_gates"):
            self.assertNotIn(mod, imported)

    def test_no_aisoc_openbot_symbols(self):
        """借鉴仓（AiSOC/OpenBot，MIT 实测）零符号——只借形态。"""
        for mod in REPLAY_MODULES:
            blob = ast.dump(ast.parse(
                (LIB / mod).read_text("utf-8"))).lower()
            for word in ("aisoc", "openbot"):
                self.assertNotIn(word, blob, f"{mod} 出现 {word}")

    def test_only_coupling_is_injected_eval_fn(self):
        """§2 钉值：opportunity_replay 静态导入全标准库——评估层经 eval_fn
        注入（零 import 耦合）。"""
        imported = _imports_of(LIB / "opportunity_replay.py")
        self.assertLessEqual(imported,
                             {"__future__", "copy", "hashlib", "json",
                              "typing"})
        src = (LIB / "opportunity_replay.py").read_text("utf-8")
        self.assertIn("eval_fn", src)


class TestRedLinePins(unittest.TestCase):
    def test_r1_pack_incomplete_refusal_pinned(self):
        """R1 行为钉值：评估缺 score/why 任一或空 evaluations →
        refused=PACK_INCOMPLETE。"""
        bad = dict(EVALS[0])
        del bad["score"]
        out = make_pack([bad], SNAPSHOTS, rules_version="v1")
        self.assertEqual(out["refused"], "PACK_INCOMPLETE")
        out2 = make_pack([], SNAPSHOTS, rules_version="v1")
        self.assertEqual(out2["refused"], "PACK_INCOMPLETE")

    def test_r2_zero_apply_trigger_ast_and_deepcopy(self):
        """R2 AST+行为（与 PRD-337/T4 同表）：零网络零子进程零投递词面；
        eval_fn 收到深拷贝 snapshots 零污染；重放返回值零投递载荷键。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "approval_dispatch"}
        for mod in REPLAY_MODULES:
            imported = _imports_of(LIB / mod)
            self.assertFalse(imported & banned,
                             f"{mod} 导入 {imported & banned}")
            src = (LIB / mod).read_text(encoding="utf-8").lower()
            for word in ("apply(", "deliver(", "submit_application"):
                self.assertNotIn(word, src, f"{mod} 出现 {word}")
        pack = make_pack(EVALS, SNAPSHOTS, rules_version="v1")

        def mutating_fn(snapshots):
            snapshots[0]["title"] = "就地改写（占位）"
            return [dict(e) for e in EVALS]

        out = replay(pack, SNAPSHOTS, mutating_fn, rules_version="v1")
        self.assertEqual(SNAPSHOTS[0]["title"], "岗位（占位）",
                         "调用方快照零污染")
        for key in ("application", "deliveries"):
            self.assertNotIn(key, out)

    def test_r3_mismatch_returns_closed_keys_no_new_recommendation(self):
        """R3 零静默钉值：mismatch 键面封闭——零回退新推荐载荷键。"""
        pack = make_pack(EVALS, SNAPSHOTS, rules_version="v1")
        out = replay(pack, SNAPSHOTS,
                     lambda s: [dict(EVALS[0], score=1)],
                     rules_version="v1")
        self.assertEqual(out["verdict"], "REPLAY_MISMATCH")
        self.assertEqual(out["evidence"]["first_divergence_index"], 0)
        self.assertEqual(set(out), {"schema", "refused", "verdict",
                                    "evidence", "rerun_count"})

    def test_r4_ledger_method_surface_closed(self):
        """R4：ReplayLedger 方法面封闭——零删除方法。"""
        led = ReplayLedger()
        methods = {n for n in dir(led) if not n.startswith("_")}
        self.assertLessEqual(methods, {"record", "entries"}, methods)
        pack = make_pack(EVALS, SNAPSHOTS, rules_version="v1")
        led.record(pack, {"verdict": "REPLAY_OK", "evidence": None},
                   at="2026-11-11T09:00:00Z")
        self.assertEqual(len(led.entries), 1)


class TestDemarcationPins(unittest.TestCase):
    def test_job_doc_snapshot_surface_unchanged(self):
        """§2 划界钉值：job_doc_snapshot 快照面（state_snapshot+
        snapshot_digest）符号不变——PRD-281 管档案可逆，本条管评估可重算，
        互不越界。"""
        import job_doc_snapshot as jds
        for name in ("state_snapshot", "snapshot_digest", "doc_context"):
            self.assertTrue(hasattr(jds, name), name)
        self.assertFalse(hasattr(jds, "replay"), "快照面不应出现重放符号")
        self.assertEqual(doc_snapshot_digest({}), doc_snapshot_digest({}))


if __name__ == "__main__":
    unittest.main()
