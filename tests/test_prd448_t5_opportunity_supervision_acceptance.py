# -*- coding: utf-8 -*-
"""PRD-448/T5 测试（trend #2164 的 T5 环节）：机会监督台验收试运行。

按 T5 issue 验收标准"全链跑通"，把 T1 设计、T2 最小实现、T3 闸门、T4 划界
串成一次端到端试运行（只读用例，全合成占位，不改 T1–T4 的设计与实现）：
  场景 A（主链）：可疑信号在采集时出炉（带两步采集过程，其中一步来源拒绝
    采集、如实显形）→ 人看过程、批注采集步骤 → 一点把"换源"发回 agent →
    agent 改完回来（版本 2）→ 人点头 → T3 闸门放行 → T4 划界认证"只证
    监督点头" → downstream_outlet 只放行已点头的信号进投递批准门；
  场景 B（未点头不进投递批准门）：待审信号在 T3 admit 与批量出口两处
    都被拦下，拦截留痕；
  场景 C（裁决时效）：放行裁决只对裁决当时的对象/版本/approved 状态有效，
    版本或对象对不上即失效，certify_gate_verdict 显形拒绝；
  场景 D（T4 划界）：监督记录含越界声称（verified）即拒绝；邻域 PRD-425/
    PRD-379/PRD-365 逐项划界在外；人不下场改内容（版本不动改内容即越界，
    resubmit 版本 +1 通过）；来源拒绝步骤不被划界藏起；
  场景 E（留痕）：三件套时间线（进度/批注/反馈）齐全；账本入账与
    latest_for 可查；闸门裁决汇总 report 计数正确。
运行：python3 -m unittest tests.test_prd448_t5_opportunity_supervision_acceptance -v
（仓库根执行；纯 unittest 用例）
零网络；全合成占位。
"""
import ast
import copy
import sys
import unittest
from pathlib import Path

MOD_DIR = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(MOD_DIR))
from opportunity_supervision_bench import (  # noqa: E402
    STATUSES, SupervisionBenchError, SupervisionBenchLedger,
    add_annotation, can_enter_downstream, decide, downstream_outlet,
    list_items, mark_viewed, new_item, refused_steps, resubmit, send_back,
    submit, timeline,
)
from opportunity_supervision_gate import (  # noqa: E402
    GateBlockedError, SupervisionGate,
)
from opportunity_supervision_boundary import (  # noqa: E402
    DOES_NOT_CERTIFY, FORBIDDEN_CLAIM_KEYS, IN_SCOPE, OUT_OF_SCOPE,
    SupervisionBoundaryError, assert_no_human_direct_edit,
    assert_supervision_only, audit_batch, boundary_report,
    certify_gate_verdict, classify_neighbour, out_of_scope_prds,
)

NOW = "2026-11-15T09:00:00Z"
HUMAN = "human（占位）"
AGENT = "agent（占位）"
PROCESS_V1 = [{"step": "抓取来源A（占位）", "status": "ok",
               "detail": "命中 1 条（占位）", "at": NOW},
              {"step": "抓取来源B（占位）", "status": "refused",
               "detail": "来源拒绝采集（占位）", "at": NOW}]
PROCESS_V2 = [{"step": "抓取来源A（占位）", "status": "ok",
               "detail": "命中 1 条（占位）", "at": NOW},
              {"step": "抓取来源C（占位）", "status": "ok",
               "detail": "命中 1 条（占位）", "at": NOW}]
CONTENT_V1 = {"title": "机会（占位）", "source": "来源A（占位）"}
CONTENT_V2 = {"title": "机会（占位）", "source": "来源A+来源C（占位）"}


def fresh(signal_id="sig-001"):
    item = new_item(signal_id, CONTENT_V1, PROCESS_V1, at=NOW)
    submit(item, by=AGENT, at=NOW)
    return item


def run_to_approved(item):
    """主链：出炉 → 看 → 批注发回 → 改回 → 点头。返回信号。"""
    mark_viewed(item, by=HUMAN, at=NOW)
    ann = add_annotation(item, step="抓取来源A（占位）",
                         text="来源A可疑，请换源（占位）", by=HUMAN, at=NOW)
    send_back(item, feedback_type="change-source",
              text="换来源C重采（占位）", reason="来源A可疑（占位）",
              annotation_ids=[ann["annotation_id"]], by=HUMAN, at=NOW)
    resubmit(item, content=CONTENT_V2, process=PROCESS_V2,
             diff_summary="来源B拒采，改用来源C（占位）", by=AGENT, at=NOW)
    decide(item, "approve", reason="同意机会（占位）", by=HUMAN, at=NOW)
    return item


class TestAcceptanceMainChain(unittest.TestCase):
    def test_full_chain_to_downstream(self):
        item = run_to_approved(fresh())
        self.assertEqual(item["status"], "approved")
        self.assertEqual(item["version"], 2)
        self.assertEqual(len(item["versions"]), 2)
        # 反爬拒绝显形：被拒的来源步骤仍在过程里，未被藏起。
        self.assertEqual([s["step"] for s in refused_steps(item)], [])
        v1_refused = refused_steps(
            {"process": PROCESS_V1})
        self.assertEqual(len(v1_refused), 1)
        # T3 闸门：唯一入口，放行。
        gate = SupervisionGate()
        verdict = gate.admit(item, by="gate（占位）", at=NOW)
        self.assertEqual(verdict["decision"], "allowed")
        self.assertTrue(gate.is_verdict_current(item, verdict))
        # T4 划界：放行裁决只证监督点头，不证真假/评审/收件箱。
        stmt = certify_gate_verdict(item, verdict)
        self.assertEqual(stmt["certifies"], "supervision-approved-only")
        self.assertEqual(list(stmt["does_not_certify"]),
                         list(DOES_NOT_CERTIFY))
        rep = boundary_report(item, verdict)
        self.assertTrue(rep["in_boundary"])
        self.assertEqual(rep["checks"]["refused_steps_visible"], [])
        # 出口：已点头的进投递批准门。
        out = downstream_outlet([item])
        self.assertEqual(len(out["passed"]), 1)
        self.assertEqual(out["blocked_count"], 0)
        self.assertTrue(can_enter_downstream(item))

    def test_gate_batch_mixed(self):
        good = run_to_approved(fresh("sig-001"))
        bad = fresh("sig-002")
        gate = SupervisionGate()
        res = gate.admit_batch([good, bad], by="gate（占位）", at=NOW)
        self.assertEqual(res["admitted_count"], 1)
        self.assertEqual(res["admitted"][0]["signal_id"], "sig-001")
        self.assertEqual(res["blocked_count"], 1)
        self.assertEqual(res["blocked"][0]["item_id"], "sig-002")
        self.assertEqual(res["blocked"][0]["status"], "in-review")
        rep = gate.report()
        self.assertEqual(rep["total"], 2)
        self.assertEqual(rep["allowed"], 1)
        self.assertEqual(rep["blocked"], 1)


class TestAcceptanceUnapprovedBlocked(unittest.TestCase):
    def test_unapproved_blocked_at_gate(self):
        item = fresh()
        gate = SupervisionGate()
        with self.assertRaises(GateBlockedError) as ctx:
            gate.admit(item, by="gate（占位）", at=NOW)
        self.assertIn("GATE_BLOCKED", str(ctx.exception))
        self.assertEqual(len(gate.blocked_decisions()), 1)
        self.assertEqual(len(gate.allowed_decisions()), 0)

    def test_unapproved_blocked_at_outlet(self):
        item = fresh()
        out = downstream_outlet([item])
        self.assertEqual(len(out["passed"]), 0)
        self.assertEqual(out["blocked_count"], 1)
        self.assertEqual(out["blocked"][0]["reason"], "未点头，不进下游")
        self.assertFalse(can_enter_downstream(item))

    def test_rejected_blocked(self):
        item = fresh()
        decide(item, "reject", reason="否决（占位）", by=HUMAN, at=NOW)
        self.assertEqual(item["status"], "rejected")
        gate = SupervisionGate()
        with self.assertRaises(GateBlockedError):
            gate.admit(item, by="gate（占位）", at=NOW)
        self.assertEqual(downstream_outlet([item])["blocked_count"], 1)


class TestAcceptanceVerdictCurrency(unittest.TestCase):
    def test_stale_verdict_rejected(self):
        item = run_to_approved(fresh())
        gate = SupervisionGate()
        verdict = gate.admit(item, by="gate（占位）", at=NOW)
        self.assertTrue(gate.is_verdict_current(item, verdict))
        # 版本对不上：旧裁决失效。
        stale = dict(verdict, version=99)
        self.assertFalse(gate.is_verdict_current(item, stale))
        with self.assertRaises(SupervisionBoundaryError):
            certify_gate_verdict(item, stale)
        # 对象对不上：裁决不能挪给另一条信号。
        other = run_to_approved(fresh("sig-002"))
        self.assertFalse(gate.is_verdict_current(other, verdict))
        with self.assertRaises(SupervisionBoundaryError):
            certify_gate_verdict(other, verdict)
        # 状态对不上：未点头的信号拿不到有效裁决。
        pending = fresh("sig-003")
        self.assertFalse(gate.is_verdict_current(pending, verdict))

    def test_resubmit_invalidates_prior_approval(self):
        # 发回→改回的新版本重新待审，不继承上一轮点头。
        item = fresh()
        send_back(item, feedback_type="remove", text="剔除（占位）",
                  reason="可疑（占位）", by=HUMAN, at=NOW)
        self.assertEqual(item["status"], "sent-back")
        resubmit(item, content=CONTENT_V2, process=PROCESS_V2,
                 diff_summary="改回（占位）", by=AGENT, at=NOW)
        self.assertEqual(item["status"], "in-review")
        self.assertEqual(item["version"], 2)
        self.assertFalse(can_enter_downstream(item))
        gate = SupervisionGate()
        with self.assertRaises(GateBlockedError):
            gate.admit(item, by="gate（占位）", at=NOW)


class TestAcceptanceBoundary(unittest.TestCase):
    def test_forbidden_claim_rejected(self):
        item = run_to_approved(fresh())
        for key in ("verified", "truth_verified", "review_passed",
                    "inbox_handled"):
            bad = dict(item, **{key: True})
            with self.assertRaises(SupervisionBoundaryError) as ctx:
                assert_supervision_only(bad)
            self.assertIn("BOUNDARY_CROSSED", str(ctx.exception))
        self.assertEqual(set(FORBIDDEN_CLAIM_KEYS),
                         {"verified", "truth_verified", "truth_score",
                          "review_passed", "reviewed", "inbox_handled"})

    def test_neighbours_out_of_scope(self):
        self.assertEqual(set(out_of_scope_prds()),
                         {"PRD-425", "PRD-379", "PRD-365"})
        for prd in ("PRD-425", "PRD-379", "PRD-365"):
            got = classify_neighbour(prd)
            self.assertIsNotNone(got)
            self.assertFalse(got["in_scope"])
        self.assertIsNone(classify_neighbour("PRD-999"))
        self.assertEqual(set(IN_SCOPE),
                         {"viewed", "annotated", "decided", "sent-back",
                          "resubmitted"})

    def test_no_human_direct_edit(self):
        before = run_to_approved(fresh())
        # 人直接改内容、版本不动：越界。
        after = copy.deepcopy(before)
        after["content"] = {"title": "被人改了（占位）"}
        with self.assertRaises(SupervisionBoundaryError) as ctx:
            assert_no_human_direct_edit(before, after)
        self.assertIn("BOUNDARY_CROSSED", str(ctx.exception))
        # resubmit 改回（版本 +1）：通过。
        item = fresh()
        send_back(item, feedback_type="add-info", text="补信息（占位）",
                  reason="缺信息（占位）", by=HUMAN, at=NOW)
        before2 = copy.deepcopy(item)
        resubmit(item, content=CONTENT_V2, process=PROCESS_V2,
                 diff_summary="补信息（占位）", by=AGENT, at=NOW)
        self.assertFalse(
            assert_no_human_direct_edit(before2, item)["direct_edit"])

    def test_audit_batch_counts_crossed(self):
        good = run_to_approved(fresh("sig-001"))
        bad = dict(run_to_approved(fresh("sig-002")),
                   **{"review_passed": True})
        res = audit_batch([good, bad])
        self.assertEqual(res["in_boundary_count"], 1)
        self.assertEqual(res["crossed_count"], 1)
        self.assertEqual(res["crossed"][0]["item_id"], "sig-002")

    def test_refused_steps_stay_visible_in_boundary_report(self):
        item = fresh()
        rep = boundary_report(item)
        self.assertEqual(rep["checks"]["refused_steps_visible"],
                         ["抓取来源B（占位）"])
        self.assertTrue(rep["in_boundary"])


class TestAcceptanceLedgerTrail(unittest.TestCase):
    def test_timeline_and_ledger(self):
        item = run_to_approved(fresh())
        rows = timeline(item)
        kinds = {r["kind"] for r in rows}
        self.assertEqual(kinds, {"progress", "annotation", "feedback"})
        events = [r["event"] for r in rows if r["kind"] == "progress"]
        for expected in ("created", "submitted", "viewed", "annotated",
                         "sent-back", "resubmitted", "approved"):
            self.assertIn(expected, events)
        led = SupervisionBenchLedger()
        rec = led.record(item)
        self.assertEqual(rec["signal_id"], "sig-001")
        self.assertEqual(led.latest_for("sig-001")["status"], "approved")
        self.assertEqual(len(led.entries()), 1)

    def test_list_items_filters_by_status(self):
        good = run_to_approved(fresh("sig-001"))
        bad = fresh("sig-002")
        self.assertEqual(len(list_items([good, bad])), 2)
        self.assertEqual(
            [i["signal_id"] for i in list_items([good, bad],
                                                status="approved")],
            ["sig-001"])
        self.assertEqual(
            [i["signal_id"] for i in list_items([good, bad],
                                                status="in-review")],
            ["sig-002"])
        with self.assertRaises(SupervisionBenchError):
            list_items([good], status="bogus")

    def test_gate_decisions_logged(self):
        good = run_to_approved(fresh("sig-001"))
        bad = fresh("sig-002")
        gate = SupervisionGate()
        gate.admit_batch([good, bad], by="gate（占位）", at=NOW)
        self.assertEqual(len(gate.decisions()), 2)
        self.assertEqual(gate.report()["by_status"],
                         {"approved": 1, "in-review": 1})


class TestAcceptanceZeroNetwork(unittest.TestCase):
    def test_zero_network_ast(self):
        src = Path(__file__).resolve().read_text(encoding="utf-8")
        tree = ast.parse(src)
        banned = {"socket", "urllib", "requests", "http", "subprocess",
                  "smtplib", "ftplib"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.assertNotIn(a.name.split(".")[0], banned)
            if isinstance(node, ast.ImportFrom) and node.module:
                self.assertNotIn(node.module.split(".")[0], banned)


if __name__ == "__main__":
    unittest.main()
