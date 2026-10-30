# -*- coding: utf-8 -*-
"""PRD-203/T2 自测（trend #1016）：JS 渲染页结构化抽取——fixture 驱动/降级记录。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from agent_browser_extract import extract_fields, batch_extract  # noqa: E402

SAMPLE_HTML = """
<div class="job-posting">
  <h2>示例研究员岗位</h2>
  <p>薪资：￥35-50万/年</p>
  <p>截止日期：2026-12-31</p>
  <p>联系方式：hr@example.edu</p>
  <p>要求博士学位或 equivalent</p>
  <p>需提交在读证明</p>
</div>
"""


class TestExtract(unittest.TestCase):
    def test_full_extraction(self):
        r = extract_fields(SAMPLE_HTML)
        self.assertIn("35", r["salary_range"])
        self.assertEqual(r["deadline"], "2026-12-31")
        self.assertEqual(r["contact"], "hr@example.edu")
        self.assertTrue(r["phd_required"])
        self.assertTrue(r["enrollment_required"])
        self.assertIsNone(r["error"])

    def test_empty_html(self):
        r = extract_fields("")
        self.assertEqual(r["error"], "empty page")

    def test_partial_fields(self):
        r = extract_fields("<p>截止日期：2026-06-30</p>")
        self.assertEqual(r["deadline"], "2026-06-30")
        self.assertIsNone(r["salary_range"])


class TestBatch(unittest.TestCase):
    def test_batch_with_failure(self):
        pages = [
            {"url": "https://example.com/job1", "html": SAMPLE_HTML},
            {"url": "https://example.com/job2", "html": ""},
        ]
        results = batch_extract(pages)
        self.assertEqual(len(results), 2)
        self.assertIsNotNone(results[0]["salary_range"])
        self.assertEqual(results[1]["error"], "empty page")

    def test_batch_all_success(self):
        pages = [{"url": "https://example.com/1", "html": SAMPLE_HTML}] * 3
        results = batch_extract(pages)
        self.assertEqual(len(results), 3)
        for r in results:
            self.assertIsNone(r["error"])


if __name__ == "__main__":
    unittest.main()
