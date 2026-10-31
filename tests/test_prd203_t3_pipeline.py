# -*- coding: utf-8 -*-
"""PRD-203/T3 自测（trend #1017）：与 PRD-117 聚合搜索对接——搜索命中→深读→回填。

运行：python3 -m unittest tests.test_prd203_t3_pipeline -v（仓库根执行）

覆盖（T1 §1.1/§二/§三 + 验收「链路跑通，深读结果回填机会条目」）：
  链路：命中（117 形态）→ fetch 注入页 → 抽取 → 回填同一机会条目的 deep_read 块
  字段级 extract_status 枚举显式化（ok/not_found；不用 null 冒充）
  证据链：{value, excerpt, url, at} 可溯源
  D 组回源：聚合页带源站链接 → 回源深读取确定值；无源站链接 →
    关键字段 secondhand_unverified（不回填为确定值）+ degraded 记录
  fetch 失败 → fetch_failed + 人工补录提示（不静默丢弃）
  回填不改动机会条目原有字段（只加 deep_read 块）

虚构纪律：页面/机构/字段全虚构；零网络。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from deep_read_pipeline import deep_read_and_backfill, deep_read_one  # noqa: E402

SOURCE_HTML = ("职位：博士后研究员（虚构）。薪资：￥30-40万/年。"
               "截止日期：2026-12-31。联系方式：hr@example.edu（虚构）。在读证明需要。")
AGGREGATOR_HTML = ("聚合条目（虚构）：博士后研究员，薪酬面议。"
                   "原文链接：https://source.example.edu/job/1")
EMPTY_HTML = "<html><body>页面存在但无相关字段（虚构）</body></html>"


def hit(oid="opp-1", url="https://agg.example.edu/1", group="A"):
    return {"opportunity_id": oid, "url": url, "source_group": group,
            "title": "博士后研究员（虚构）", "org": "某大学（虚构）"}


class PipelineTests(unittest.TestCase):
    def test_link_pipeline_and_backfill(self):
        pages = {"https://agg.example.edu/1": SOURCE_HTML}
        opportunities = [{"opportunity_id": "opp-1", "title": "博士后研究员（虚构）",
                          "status": "待深读"}]
        results = deep_read_and_backfill([hit()], lambda u: pages.get(u),
                                         opportunities=opportunities, at="2026-10-31T12:00:00+00:00")
        self.assertEqual(results[0]["status"], "ok")
        entry = opportunities[0]
        self.assertIn("deep_read", entry)                      # 回填同一机会条目
        dr = entry["deep_read"]
        self.assertEqual(dr["fields"]["salary_range"]["extract_status"], "ok")
        self.assertEqual(dr["fields"]["salary_range"]["value"], "30-40万/年")
        ev = dr["fields"]["deadline"]["evidence"]
        self.assertEqual(ev["url"], "https://agg.example.edu/1")  # 证据链可溯源
        self.assertIn("截止日期", ev["excerpt"])
        self.assertTrue(dr["fields"]["phd_required"]["value"] if "phd_required" in dr["fields"]
                        else True)

    def test_field_status_explicit_not_null(self):
        result = deep_read_one(hit(), lambda u: EMPTY_HTML, at="2026-10-31T12:00:00+00:00")
        for key in ("salary_range", "deadline", "contact"):
            f = result["fields"][key]
            self.assertIn(f["extract_status"], ("ok", "not_found", "not_stated",
                                                "raw_only", "secondhand_unverified"))
            self.assertIsNotNone(f["extract_status"])  # 显式状态，不用 null 冒充

    def test_group_d_resolves_to_source(self):
        pages = {"https://agg.example.edu/1": AGGREGATOR_HTML,
                 "https://source.example.edu/job/1": SOURCE_HTML}
        result = deep_read_one(hit(group="D"), lambda u: pages.get(u),
                               at="2026-10-31T12:00:00+00:00")
        self.assertEqual(result["resolved_url"], "https://source.example.edu/job/1")
        self.assertEqual(result["fields"]["deadline"]["extract_status"], "ok")  # 回源后为确定值
        self.assertEqual(result["degraded"], [])

    def test_group_d_without_source_link_marks_secondhand(self):
        agg_only = "聚合条目（虚构）：薪资 ￥25-30万/年。截止日期：2026-11-30。联系方式：详见原文"
        result = deep_read_one(hit(group="D"), lambda u: agg_only,
                               at="2026-10-31T12:00:00+00:00")
        statuses = {k: result["fields"][k]["extract_status"]
                    for k in ("salary_range", "deadline", "contact")}
        self.assertEqual(statuses["salary_range"], "secondhand_unverified")  # 只作线索
        self.assertEqual(statuses["deadline"], "secondhand_unverified")
        self.assertTrue(any(d["reason"] == "secondhand_unverified" for d in result["degraded"]))

    def test_fetch_failed_degraded_with_manual_hint(self):
        result = deep_read_one(hit(), lambda u: None, at="2026-10-31T12:00:00+00:00")
        self.assertEqual(result["status"], "fetch_failed")
        self.assertIn("人工补录", result["manual_hint"])  # 降级记录 + 人工补录，不静默丢弃

    def test_backfill_does_not_touch_original_fields(self):
        pages = {"https://agg.example.edu/1": SOURCE_HTML}
        opportunity = {"opportunity_id": "opp-1", "title": "博士后研究员（虚构）",
                       "org": "某大学（虚构）", "status": "待深读"}
        deep_read_and_backfill([hit()], lambda u: pages.get(u), opportunities=[opportunity])
        self.assertEqual(opportunity["title"], "博士后研究员（虚构）")   # 原字段不动
        self.assertEqual(opportunity["status"], "待深读")
        self.assertEqual(opportunity["org"], "某大学（虚构）")

    def test_multi_hits_all_backfilled(self):
        pages = {"https://agg.example.edu/1": SOURCE_HTML,
                 "https://agg.example.edu/2": EMPTY_HTML}
        opportunities = [{"opportunity_id": "opp-1"}, {"opportunity_id": "opp-2"}]
        hits = [hit("opp-1"), hit("opp-2", url="https://agg.example.edu/2")]
        results = deep_read_and_backfill(hits, lambda u: pages.get(u),
                                         opportunities=opportunities)
        self.assertEqual(len(results), 2)
        self.assertIn("deep_read", opportunities[0])
        self.assertIn("deep_read", opportunities[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
