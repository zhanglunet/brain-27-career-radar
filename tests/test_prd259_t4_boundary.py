# -*- coding: utf-8 -*-
"""PRD-259/T4 自测（trend #1298）：与 PRD-117/203 边界文档——边界说明齐全。

运行：python3 -m pytest tests/test_prd259_t4_boundary.py -q
（或 python3 -m unittest tests.test_prd259_t4_boundary）

覆盖（issue #1298 验收口径）：
  文档存在：docs/plans/2026-10-28-prd-259-boundary-117-203.md 在位；
  含 117 与 203 小节：两节边界表/职责划分齐全；
  含对接约定：source_handle（117→259）/ is_healthy（203→259）/ 事件对接；
  含 ASCII 分层图；
  红线：文档零密钥、零内网 IP（示例一律占位）。
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "plans" / "2026-10-28-prd-259-boundary-117-203.md"


class TestBoundaryDoc(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = DOC.read_text(encoding="utf-8") if DOC.exists() else ""

    def test_doc_exists(self):
        self.assertTrue(DOC.exists(), f"边界文档缺失: {DOC}")
        self.assertIn("PRD-259", self.text)
        self.assertIn("边界", self.text)

    def test_has_117_and_203_sections(self):
        # 各自独立小节 + 职责表述：117 管搜索聚合（拿源做什么）/ 259 管来源健康切换
        headings = re.findall(r"^#+\s+.*$", self.text, re.M)
        self.assertTrue(any("PRD-117" in h for h in headings), f"缺 117 小节: {headings}")
        self.assertTrue(any("PRD-203" in h for h in headings), f"缺 203 小节: {headings}")
        self.assertIn("搜索聚合", self.text)
        self.assertIn("来源健康", self.text)
        self.assertIn("可达性", self.text)
        # 边界一句话（T1 §3.4 口径）
        self.assertIn("源活着吗", self.text)
        self.assertIn("拿它做什么", self.text)

    def test_has_integration_contract(self):
        # 对接约定：117 向 259 要 source_handle；203 查 is_healthy；事件对接
        self.assertIn("source_handle", self.text)
        self.assertIn("is_healthy", self.text)
        self.assertIn("exportEvents", self.text)
        self.assertIn("对接约定", self.text)

    def test_has_ascii_layer_diagram(self):
        self.assertIn("```", self.text)  # 存在围栏代码块
        blocks = re.findall(r"```(?:\w*\n)?(.*?)```", self.text, re.S)
        diagram = "\n".join(blocks)
        self.assertIn("PRD-259", diagram)
        self.assertIn("PRD-117", diagram)
        self.assertIn("PRD-203", diagram)
        self.assertIn("公开机会源", diagram)

    def test_no_secrets_or_internal_hosts(self):
        # 红线：零密钥样例、零内网 IP/主机名（示例一律 example.com 系占位）
        self.assertNotRegex(self.text, r"sk-[A-Za-z0-9]{8,}")
        self.assertNotRegex(self.text, r"AKIA[0-9A-Z]{8,}")
        self.assertNotRegex(self.text, r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b")
        for url in re.findall(r"https?://([^/\s)\"']+)", self.text):
            host = url.split("@")[-1]
            allowed = ("example.com", "github.com", "mirror.example.com",
                       "jobs.example.com", "api.example.com")
            self.assertTrue(any(host == h or host.endswith("." + h) for h in allowed),
                            f"文档出现非占位主机: {host}")


if __name__ == "__main__":
    unittest.main()
