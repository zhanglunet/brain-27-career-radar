# -*- coding: utf-8 -*-
"""PRD-365/T4 测试（trend #1644 的 T4 环节）：投递审批收件箱划界断言。

运行：python3 -m unittest tests.test_prd365_t4_approval_inbox_boundary -v
（仓库根执行）

覆盖（T1 §0/§2，验收「划界断言通过」）：
  ① 模块隔离双向：approval_inbox/approval_inbox_gates 零导入
    approval_dispatch（PRD-175 批准门——门继续各拦各的零 import）/
    ref_resolver（PRD-295 二值返回）/job_doc_snapshot（PRD-281 草稿）/
    public_info_aggregate（PRD-337 聚合）/opportunity_replay*（PRD-351
    重放——fingerprint 同源模块隔离）+ 借鉴词零出现（plannotator/t3code
    只借控制面形态）；approval_dispatch 零导入 approval_inbox*（仅代码
    标识符扫描，docstring 提及不算）；
  ② 零网络零子进程零投递词面 AST（R1，与 337/T4 同表）；
  ③ R1 零自动执行 AST+行为：approve 携带 closed 词表投递载荷
    （deliver/submit）→ INBOX_AUTO_EXEC_ATTEMPT 显形拒绝；裁决返回值
    零投递触发载荷键；
  ④ R2 只读汇聚行为钉值：collect 注入式三源齐收（delivery_approval/
    ref_disambiguation/profile_draft_confirm 词表封闭），零内核调用面；
  ⑤ R3 每项带证据钉值：投递项缺 fingerprint/reason →
    INBOX_ITEM_INCOMPLETE 显形拒绝入箱+候选须在列表内（CHOICE_REQUIRED
    同族语义钉值）；
  ⑥ R4：InboxLedger 方法面封闭（零删除方法）+reject 留痕钉值；
  ⑦ §2 划界钉值：approval_dispatch 面（GateDenied+APPROVAL_STATUSES
    default-deny）符号不变——门内人工归 175、收件箱零投递触发，互不
    越界。
零网络；全合成占位。
"""
import ast
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(LIB))

from approval_inbox import (  # noqa: E402
    InboxError,
    InboxLedger,
    ITEM_KINDS,
    collect,
)
from approval_dispatch import APPROVAL_STATUSES, GateDenied  # noqa: E402

NOW = "2026-11-11T09:00:00Z"
FP = "sha16:snap（占位）"
DELIVERY = [{"source_ref": "approval-gate/v1#pending[0]（占位）",
             "fingerprint": FP, "reason": "待批投递（占位）"}]
DISAMB = [{"source_ref": "ref-resolution/v1（占位）", "fingerprint": FP,
           "candidates": ["O-001（占位）", "O-002（占位）"],
           "reason": "歧义候选（占位）"}]
DRAFT = [{"source_ref": "profile-draft#1（占位）", "fingerprint": FP,
          "reason": "草稿确认（占位）"}]

INBOX_MODULES = ["approval_inbox.py", "approval_inbox_gates.py"]


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
    def test_inbox_never_imports_gate_resolver_snapshot_or_replay(self):
        """收件箱面零触碰批准门/引用解析/档案快照/聚合/重放（只读消费=
        注入式；门继续各拦各的）。"""
        for mod in INBOX_MODULES:
            imported = _imports_of(LIB / mod)
            for banned in ("approval_dispatch", "ref_resolver",
                           "job_doc_snapshot", "public_info_aggregate",
                           "opportunity_replay", "opportunity_replay_gates"):
                self.assertNotIn(banned, imported, f"{mod} 导入 {banned}")
            names = _code_names(LIB / mod)
            for symbol in ("GateDenied", "resolve", "state_snapshot",
                           "make_pack"):
                self.assertNotIn(symbol, names, f"{mod} 引用 {symbol}")

    def test_gate_never_imports_inbox(self):
        """批准门面零导入收件箱（PRD-175 不感知本条——双向隔离）。"""
        imported = _imports_of(LIB / "approval_dispatch.py")
        for mod in ("approval_inbox", "approval_inbox_gates"):
            self.assertNotIn(mod, imported)

    def test_no_plannotator_t3code_symbols(self):
        """借鉴仓（plannotator Apache-2.0/t3code MIT 实测）零符号——只借
        控制面形态。"""
        for mod in INBOX_MODULES:
            blob = ast.dump(ast.parse(
                (LIB / mod).read_text("utf-8"))).lower()
            for word in ("plannotator", "t3code"):
                self.assertNotIn(word, blob, f"{mod} 出现 {word}")


class TestRedLinePins(unittest.TestCase):
    def test_r1_zero_delivery_ast_and_payload_rejected(self):
        """R1 AST+行为（与 337/T4 同表）：收件箱两模块零网络零子进程；
        投递词面零出现；approve 携带 closed 词表载荷（deliver/submit）→
        INBOX_AUTO_EXEC_ATTEMPT 显形拒绝；裁决返回值零投递触发载荷键。"""
        banned = {"urllib", "requests", "socket", "http", "subprocess"}
        for mod in INBOX_MODULES:
            imported = _imports_of(LIB / mod)
            self.assertFalse(imported & banned,
                             f"{mod} 导入 {imported & banned}")
            names = {n.lower() for n in _code_names(LIB / mod)}
            for word in ("deliver_now", "submit_application"):
                self.assertNotIn(word, names, f"{mod} 出现 {word}")
        items = collect(delivery_pending=DELIVERY,
                        ref_disambiguations=DISAMB, profile_drafts=DRAFT,
                        at=NOW)
        led = InboxLedger()
        led.add(items)
        iid = items[0]["item_id"]
        with self.assertRaisesRegex(InboxError, "INBOX_AUTO_EXEC_ATTEMPT"):
            led.approve(iid, by="人（占位）", at=NOW,
                        payload={"deliver": True})
        out = led.approve(iid, by="人（占位）", at=NOW)
        for key in ("delivered", "submitted", "application"):
            self.assertNotIn(key, out)

    def test_r2_collect_injected_three_sources(self):
        """R2 只读汇聚行为钉值：collect 注入式三源齐收（词表封闭），零
        内核调用面。"""
        items = collect(delivery_pending=DELIVERY,
                        ref_disambiguations=DISAMB, profile_drafts=DRAFT,
                        at=NOW)
        self.assertEqual([it["kind"] for it in items],
                         ["delivery_approval", "ref_disambiguation",
                          "profile_draft_confirm"])
        self.assertEqual(set(ITEM_KINDS),
                         {"delivery_approval", "ref_disambiguation",
                          "profile_draft_confirm"})

    def test_r3_incomplete_refused_and_candidates_pinned(self):
        """R3 行为钉值：投递项缺 reason（必填）→ INBOX_ITEM_INCOMPLETE
        显形拒绝入箱；歧义项候选列表保留（CHOICE_REQUIRED 同族语义——
        人工在候选内选）。"""
        bad = dict(DELIVERY[0])
        del bad["reason"]
        with self.assertRaisesRegex(InboxError, "INBOX_ITEM_INCOMPLETE"):
            collect(delivery_pending=[bad], at=NOW)
        items = collect(ref_disambiguations=DISAMB, at=NOW)
        self.assertEqual(items[0]["candidates"],
                         ["O-001（占位）", "O-002（占位）"])

    def test_r4_ledger_surface_closed_and_reject_trace(self):
        """R4：InboxLedger 方法面封闭（零删除方法）+reject 留痕钉值。"""
        led = InboxLedger()
        methods = {n for n in dir(led) if not n.startswith("_")}
        self.assertLessEqual(methods, {"add", "approve", "reject", "view",
                                       "events"}, methods)
        items = collect(delivery_pending=DELIVERY, at=NOW)
        led.add(items)
        iid = items[0]["item_id"]
        out = led.reject(iid, by="人（占位）", at=NOW, reason="不投（占位）")
        self.assertEqual(out["reject_reason"], "不投（占位）")
        self.assertEqual(len(led.events), 2)   # add + rejected（只增）


class TestDemarcationPins(unittest.TestCase):
    def test_approval_gate_surface_unchanged(self):
        """§2 划界钉值：approval_dispatch 面（APPROVAL_STATUSES 四态+
        GateDenied default-deny 异常）符号不变——门内人工归 175、收件箱
        零投递触发，互不越界。"""
        import approval_dispatch as ad
        self.assertEqual(APPROVAL_STATUSES,
                         ("pending", "approved", "rejected", "expired"))
        self.assertTrue(issubclass(GateDenied, Exception))
        self.assertFalse(hasattr(ad, "collect_inbox"),
                         "门面不应出现收件箱符号")


if __name__ == "__main__":
    unittest.main()
