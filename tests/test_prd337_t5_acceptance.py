# -*- coding: utf-8 -*-
"""PRD-337/T5 测试（trend #1616 的 T5 环节）：公开信息聚合验收试运行。

运行：python3 -m unittest tests.test_prd337_t5_acceptance -v（仓库根执行）

覆盖（T1 §5 验收「stub 来源全链回放 + 全 blocked 演练 + 文档无密钥」）：
① stub 来源全链回放——四来源 stub（两成功/一反爬拒绝/一不可达）→
  aggregate → persist_gate 全链；entries 三件套齐 + blocked 三码归类全显形；
  回放可复现逐字节一致；
② 全 blocked 演练——四来源全部拒绝 → entries=[] 一无所获也是如实结果
  （allow_empty 零伪装）；
③ 文档无密钥——T1 设计文档（T1 分支）零密钥/零凭证形态/零 IP/外链仅
  github 与 example 域。
零网络；全合成占位。
"""
import copy
import re
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "lib"))

from aggregate_gate import classify_blocked, persist_gate  # noqa: E402
from public_info_aggregate import aggregate  # noqa: E402

NOW = "2026-11-10T09:00:00Z"
TARGET = {"kind": "company", "name": "公司 C-001（占位）"}


def ok_site(target):
    return [{"url": "https://c001.example.invalid/news（占位）",
             "summary": "公开动态（占位）"}]


def ok_jobs(target):
    return [{"url": "https://jobs.example.invalid/c001/1（占位）",
             "summary": "公开职位（占位）"}]


def blocked_site(target):
    raise RuntimeError("反爬拒绝（占位）")


def unreachable(target):
    raise RuntimeError("SOURCE_UNREACHABLE：网络不可达（占位）")


class TestFullReplay(unittest.TestCase):
    def test_stub_sources_full_chain(self):
        """① 全链回放：两成功/一反爬/一不可达 → 聚合+闸门全链落位。"""
        out = aggregate(TARGET, {"company_site": ok_site,
                                 "public_job_page": ok_jobs,
                                 "public_event": blocked_site,
                                 "public_academic": unreachable}, now=NOW)
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "allow")
        self.assertEqual(len(out["entries"]), 2)   # 两来源各一条
        for e in out["entries"]:
            self.assertTrue(e["source_id"] and e["url"]
                            and e["captured_at"] == NOW)
        counts = classify_blocked(out)
        self.assertEqual(counts["SOURCE_BLOCKED"], 1)
        self.assertEqual(counts["SOURCE_UNREACHABLE"], 1)
        self.assertGreaterEqual(gate["blocked_visible"], 2)   # blocked 全显形

    def test_replay_reproducible(self):
        """① 回放可复现：同 stub 重放逐字节一致。"""
        def run():
            out = aggregate(TARGET, {"company_site": ok_site,
                                     "public_job_page": ok_jobs,
                                     "public_event": blocked_site,
                                     "public_academic": unreachable}, now=NOW)
            return copy.deepcopy(out)
        self.assertEqual(run(), run())


class TestAllBlockedDrill(unittest.TestCase):
    def test_all_blocked_honest_empty(self):
        """② 全 blocked 演练：entries=[] 一无所获也是如实结果（零伪装）。"""
        out = aggregate(TARGET, {"company_site": blocked_site,
                                 "public_job_page": blocked_site,
                                 "public_event": blocked_site,
                                 "public_academic": blocked_site}, now=NOW)
        self.assertEqual(out["entries"], [])
        gate = persist_gate(out)
        self.assertEqual(gate["gate"], "allow_empty")
        self.assertIn("一无所获", gate["note"])
        self.assertEqual(gate["blocked_visible"], 4)   # 四来源 blocked 全显形


class TestDocNoSecrets(unittest.TestCase):
    def test_design_doc_no_secrets(self):
        """③ 文档无密钥：T1 设计文档（T1 分支）零密钥/零凭证/零 IP/外链仅
        github 与 example 域。"""
        doc = subprocess.run(
            ["git", "show", "origin/trend/prd-337-t1-public-info-design:"
             "docs/plans/2026-11-09-prd-337-public-info-aggregate-design.md"],
            capture_output=True, text=True, check=True).stdout
        # 凭证「赋值/注入」形态才算命中——红线声明文字（零 cookie/零 token）
        # 不算（文档在声明红线，不是在携带凭证）
        for token in ("password", "api_key=", "cookie=", "token=", "AKIA",
                      "Bearer ", "BEGIN RSA"):
            self.assertNotIn(token.lower(), doc.lower(), token)
        self.assertEqual(re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", doc), [])
        for m in re.findall(r"https?://[^\s）)】]+", doc):
            self.assertTrue(any(ok in m for ok in
                                ("github.com", "example.invalid",
                                 "example.com")), m)


if __name__ == "__main__":
    unittest.main()
