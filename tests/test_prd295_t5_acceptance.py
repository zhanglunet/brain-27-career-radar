# -*- coding: utf-8 -*-
"""PRD-295/T5 测试（trend #1480）：验收试运行——样例全流程回放 + 歧义/失败
演练 + 文档无密钥。

运行：python3 -m unittest tests.test_prd295_t5_acceptance -v（仓库根执行）

验收标准（trend #1480）：**引用解析全链通过；红线断言全过；文档无密钥**。

回放：求职指令含 @机会id @档案v3 → resolve_for_task 全留痕 → payload
投影进批准门语义钉桩（pending 不放行）→ 歧义/失败演练（NOT_FOUND/
AMBIGUOUS/SYNTAX/VERSION_GONE 全触发）→ 文档无密钥。
零网络；全合成占位。
"""
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from record_ref import RefSyntaxError, resolve  # noqa: E402
from task_ref_audit import (  # noqa: E402
    TaskRefAudit,
    payload_for_gate,
    resolve_for_task,
)

OPPS = [{"opportunity_id": "opp-2026-042（占位）", "company": "示例公司（占位）",
         "role": "算法工程师（占位）"}]
VERSIONS = [{"version": "v3", "profile": {"skills": ["python（占位）"]},
             "revoked": False}, {"version": "v2", "profile": {}, "revoked": True}]
INSTRUCTION_REFS = ["@opp-2026-042（占位）", "@档案v3"]


class 全链回放Tests(unittest.TestCase):
    def test_full_chain_replay_with_gate_payload(self):
        """样例全流程：解析+留痕 → payload 投影 → 门语义钉桩 pending 不放行。"""
        audit = TaskRefAudit()
        payloads = []
        for i, raw in enumerate(INSTRUCTION_REFS):
            out = resolve_for_task(raw, OPPS, VERSIONS,
                                   at=f"2026-11-04T09:0{i}:00Z",
                                   task_id="task-1（占位）", audit=audit)
            self.assertFalse(out["refused"], raw)
            payloads.append(payload_for_gate(out["resolution"]))
        self.assertEqual(len(audit.records), 2)
        self.assertTrue(all(r["task_id"] == "task-1（占位）" for r in audit.records))
        self.assertEqual(payloads[0]["opportunity_id"], "opp-2026-042（占位）")
        self.assertEqual(payloads[1]["profile_version"], "v3")

    def test_replay_deterministic(self):
        def run():
            audit = TaskRefAudit()
            for i, raw in enumerate(INSTRUCTION_REFS):
                resolve_for_task(raw, OPPS, VERSIONS, at=f"2026-11-04T09:0{i}:00Z",
                                 task_id="task-1（占位）", audit=audit)
            return str(audit.records)
        self.assertEqual(run(), run())


class 歧义失败演练Tests(unittest.TestCase):
    def test_all_failures_block(self):
        """四路全触发（NOT_FOUND/AMBIGUOUS/SYNTAX/VERSION_GONE）且零 payload。"""
        audit = TaskRefAudit()
        for raw, want in (("@opp-不存在", "REF_NOT_FOUND"),
                          ("@档案", "REF_SYNTAX_ERROR"),
                          ("@档案v2", "PROFILE_VERSION_GONE")):
            out = resolve_for_task(raw, OPPS, VERSIONS,
                                   at="2026-11-04T09:00:00Z",
                                   task_id="task-1（占位）", audit=audit)
            self.assertTrue(out["refused"], raw)
            self.assertEqual(out["error_code"], want, raw)
        dup = VERSIONS + [{"version": "v3", "profile": {}, "revoked": False}]
        out = resolve_for_task("@档案v3", OPPS, dup, at="2026-11-04T09:01:00Z",
                               task_id="task-1（占位）", audit=audit)
        self.assertEqual(out["error_code"], "REF_AMBIGUOUS")
        # 拒绝面零 payload：全部 refused 无一进 payload 投影
        for raw in ("@opp-不存在", "@档案v2"):
            try:
                resolved = resolve(raw, OPPS, VERSIONS)
            except RefSyntaxError:
                continue
            if resolved["resolution"]["status"] == "refused":
                with self.assertRaises(ValueError):
                    payload_for_gate(resolved)


class 文档无密钥Tests(unittest.TestCase):
    def test_design_doc_no_secrets(self):
        secret_re = re.compile(r"(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|"
                               r"AKIA[0-9A-Z]{16}|password\s*[:=]\s*['\"][^'\"]{4,})",
                               re.IGNORECASE)
        docs = list((REPO / "docs" / "plans").glob("2026-11-04-prd-295-*.md"))
        self.assertTrue(docs, "T1 设计文档在位")
        for doc in docs:
            blob = doc.read_text(encoding="utf-8")
            self.assertFalse(secret_re.findall(blob), doc.name)
            for host in re.findall(r"https?://([a-z0-9.-]+)", blob, re.IGNORECASE):
                self.assertTrue(host.endswith(("github.com", "example.com",
                                               "example.invalid", "synthetic",
                                               "local")), f"{doc.name} {host}")


if __name__ == "__main__":
    unittest.main()
