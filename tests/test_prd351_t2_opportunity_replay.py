# -*- coding: utf-8 -*-
"""PRD-351/T2 测试（trend #1630 的 T2 环节）：机会评估重放包。

运行：python3 -m unittest tests.test_prd351_t2_opportunity_replay -v（仓库根执行）

覆盖（T1 §3.1/§3.2/§4 + R1–R4）：三件套构建（评估缺字段/空入参
PACK_INCOMPLETE）；重放三步（同快照同规则 REPLAY_OK/快照或版本漂移
INPUT_DRIFT 拒绝防新快照冒充当时/决策漂移 MISMATCH 首分歧条显形）；R2 投递
零自动（AST 零投递导入与 337/T4 同表）；R4 账本 append-only；与 PRD-337
聚合报告串联（aggregate entries 可作快照来源 digest 同源）。零网络；全合成
占位。
"""
import ast
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from opportunity_replay import (  # noqa: E402
    ERROR_CODES,
    ReplayLedger,
    make_pack,
    replay,
)
from public_info_aggregate import aggregate  # noqa: E402

NOW = "2026-11-11T09:00:00Z"
SNAPSHOTS = [{"opportunity_id": "O-001（占位）", "title": "岗位（占位）",
              "url": "https://o001.example.invalid/1（占位）"}]
EVALS = [{"opportunity_id": "O-001（占位）", "score": 78,
          "weights": {"技能匹配": 0.6}, "why": "技能匹配度高（占位）"}]


def eval_fn(snapshots):
    return [dict(e) for e in EVALS]


class TestPackBuild(unittest.TestCase):
    def test_pack_three_parts_complete(self):
        pack = make_pack(EVALS, SNAPSHOTS, rules_version="v1")
        self.assertEqual(pack["schema"], "opportunity-replay-pack/v1")
        fp = pack["input_fingerprint"]
        self.assertTrue(fp["snapshot_digest"].startswith("sha16:"))
        self.assertEqual(fp["rules_version"], "v1")
        self.assertEqual(pack["output"]["recommendations"], ["recommend"])

    def test_incomplete_refused(self):
        bad = dict(EVALS[0])
        del bad["why"]
        self.assertEqual(make_pack([bad], SNAPSHOTS,
                                   rules_version="v1")["refused"],
                         "PACK_INCOMPLETE")
        self.assertEqual(make_pack([], SNAPSHOTS,
                                   rules_version="v1")["refused"],
                         "PACK_INCOMPLETE")
        self.assertEqual(make_pack(EVALS, SNAPSHOTS,
                                   rules_version="")["refused"],
                         "PACK_INCOMPLETE")


class TestReplay(unittest.TestCase):
    def _pack(self):
        return make_pack(EVALS, SNAPSHOTS, rules_version="v1")

    def test_same_snapshots_replay_ok(self):
        out = replay(self._pack(), SNAPSHOTS, eval_fn, rules_version="v1")
        self.assertEqual(out["verdict"], "REPLAY_OK")

    def test_input_drift_refused(self):
        """指纹复核：快照/版本漂移 → INPUT_DRIFT 拒绝（防新快照冒充）。"""
        mutated = [dict(SNAPSHOTS[0], title="变化（占位）")]
        out = replay(self._pack(), mutated, eval_fn, rules_version="v1")
        self.assertEqual(out["refused"], "REPLAY_INPUT_DRIFT")
        out2 = replay(self._pack(), SNAPSHOTS, eval_fn, rules_version="v2")
        self.assertEqual(out2["refused"], "REPLAY_INPUT_DRIFT")

    def test_mismatch_first_divergence_visible(self):
        """R3：评估漂移 → MISMATCH 首分歧条显形，零静默换新推荐。"""
        drift_fn = lambda s: [dict(EVALS[0], score=55)]
        out = replay(self._pack(), SNAPSHOTS, drift_fn, rules_version="v1")
        self.assertEqual(out["verdict"], "REPLAY_MISMATCH")
        self.assertEqual(out["evidence"]["first_divergence_index"], 0)
        self.assertEqual(out["evidence"]["got"]["score"], 55)
        out2 = replay(self._pack(), SNAPSHOTS, lambda s: [],
                      rules_version="v1")
        self.assertEqual(out2["verdict"], "REPLAY_MISMATCH")
        self.assertEqual(out2["evidence"]["got"], None)

    def test_incomplete_pack_refused(self):
        out = replay({"schema": "opportunity-replay-pack/v1"}, SNAPSHOTS,
                     eval_fn, rules_version="v1")
        self.assertEqual(out["refused"], "PACK_INCOMPLETE")


class TestLedgerAndChain(unittest.TestCase):
    def test_ledger_append_only(self):
        led = ReplayLedger()
        pack = make_pack(EVALS, SNAPSHOTS, rules_version="v1")
        led.record(pack, {"verdict": "REPLAY_OK", "evidence": None}, at=NOW)
        before = [dict(x) for x in led.entries]
        led.record(pack, {"refused": "REPLAY_INPUT_DRIFT", "evidence": None},
                   at=NOW)
        self.assertEqual(led.entries[0], before[0])
        self.assertEqual(len(led.entries), 2)

    def test_error_codes_closed(self):
        self.assertEqual(set(ERROR_CODES),
                         {"REPLAY_INPUT_DRIFT", "REPLAY_MISMATCH",
                          "PACK_INCOMPLETE"})

    def test_chain_with_prd337_aggregate(self):
        """与 PRD-337 串联：聚合 entries 作机会快照来源（digest 同源）。"""
        def ok_fetch(target):
            return [{"url": "https://o001.example.invalid/a（占位）",
                     "summary": "公开动态（占位）"}]
        report = aggregate({"kind": "company", "name": "C-001（占位）"},
                           {"company_site": ok_fetch}, now=NOW)
        snapshots = report["entries"]
        pack = make_pack(EVALS, snapshots, rules_version="v1")
        out = replay(pack, snapshots, eval_fn, rules_version="v1")
        self.assertEqual(out["verdict"], "REPLAY_OK")

    def test_ast_zero_delivery(self):
        """R2 AST：投递零自动——零投递导入（与 337/T4 同表）。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess",
                  "smtp", "delivery", "apply"}
        tree = ast.parse((REPO / "lib" / "opportunity_replay.py").read_text(
            encoding="utf-8"))
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods = [node.module.split(".")[0]]
            for mod in mods:
                self.assertNotIn(mod, banned)


if __name__ == "__main__":
    unittest.main()
