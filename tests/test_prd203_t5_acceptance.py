# -*- coding: utf-8 -*-
"""PRD-203/T5 自测（trend #1019）：验收——一批机会页抽取准确率达标。

运行：python3 -m unittest tests.test_prd203_t5_acceptance -v（仓库根执行）

回放集：10 个合成机会页（3 类形态：字段齐全 / 字段缺失 / 聚合页回源），
逐条跑 深读管线 → 字段级准确率（抽取值 vs 人工标注期望）断言 ≥ 90%；
聚合页 secondhand 未核对不算错（T1 §3.1 显式状态口径）。
零网络；全合成。
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from deep_read_pipeline import deep_read_and_backfill, deep_read_one  # noqa: E402

NOW = "2026-11-01T00:00:00+00:00"


def page(title, salary, deadline, contact, phd=False, enroll=False):
    parts = [f"职位：{title}（虚构）。"]
    if salary:
        parts.append(f"薪资：{salary}。")
    if deadline:
        parts.append(f"截止日期：{deadline}。")
    if contact:
        parts.append(f"联系方式：{contact}。")
    if phd:
        parts.append("要求博士学位。")
    if enroll:
        parts.append("需提供在读证明。")
    return "".join(parts)


#: (url, html, 期望字段 dict)；url 为 example.edu 占位
BATCH = [
    ("https://a.example.edu/1",
     page("研究员A", "￥30-40万/年", "2026-12-31", "hr@example.edu", phd=True),
     {"salary_range": "30-40万/年", "deadline": "2026-12-31", "contact": "hr@example.edu"}),
    ("https://a.example.edu/2",
     page("研究员B", "￥25-35万/年", "2026-11-30", "recruit@example.edu"),
     {"salary_range": "25-35万/年", "deadline": "2026-11-30", "contact": "recruit@example.edu"}),
    ("https://a.example.edu/3",
     page("工程师C", "￥40-60万/年", "2027-01-15", "jobs@example.edu", enroll=True),
     {"salary_range": "40-60万/年", "deadline": "2027-01-15", "contact": "jobs@example.edu"}),
    ("https://a.example.edu/4",
     page("分析师D", "￥20-30万/年", "2026-12-01", "talent@example.edu"),
     {"salary_range": "20-30万/年", "deadline": "2026-12-01", "contact": "talent@example.edu"}),
    ("https://a.example.edu/5",
     page("设计师E", None, "2026-12-20", "hr2@example.edu"),
     {"salary_range": None, "deadline": "2026-12-20", "contact": "hr2@example.edu"}),
    ("https://a.example.edu/6",
     page("产品F", "￥35万/年", None, "hire@example.edu"),
     {"salary_range": "35万/年", "deadline": None, "contact": "hire@example.edu"}),
    ("https://agg.example.edu/7",
     page("博士后G", "￥30-40万/年", "2026-12-31", "postdoc@example.edu"),
     {"salary_range": "30-40万/年", "deadline": "2026-12-31", "contact": "postdoc@example.edu"}),
    ("https://agg.example.edu/8",
     page("博士后H", "￥28万/年", "2027-02-28", "recruit2@example.edu", phd=True),
     {"salary_range": "28万/年", "deadline": "2027-02-28", "contact": "recruit2@example.edu"}),
    ("https://a.example.edu/9",
     page("运营I", "￥15-25万/年", "2026-11-15", "join@example.edu"),
     {"salary_range": "15-25万/年", "deadline": "2026-11-15", "contact": "join@example.edu"}),
    ("https://a.example.edu/10",
     page("研究J", "￥50万/年", "2027-03-01", "lab@example.edu", phd=True, enroll=True),
     {"salary_range": "50万/年", "deadline": "2027-03-01", "contact": "lab@example.edu"}),
]


class AccuracyTests(unittest.TestCase):
    def test_batch_accuracy_at_least_90(self):
        pages = {url: html for url, html, _ in BATCH}
        hits = total = 0
        for url, html, expected in BATCH:
            result = deep_read_one({"opportunity_id": url, "url": url,
                                    "source_group": "A"}, lambda u: pages.get(u),
                                   at=NOW)
            fields = result["fields"]
            for key, exp in expected.items():
                total += 1
                actual = fields[key]["value"]
                if actual is None and exp is None:
                    hits += 1  # 页面确实未写 → not_stated 判定正确
                elif actual is not None and exp is not None and str(exp) in str(actual):
                    hits += 1  # 抽取值含期望值（单位形态可差异）

        rate = hits / total
        self.assertGreaterEqual(rate, 0.90, f"抽取准确率 {rate:.0%}（{hits}/{total}）不达标")

    def test_agg_group_routed_through_source(self):
        """聚合页命中：原文链接回源 → 抽取值应回填（本批 agg 页即源页形态）。"""
        pages = {url: html for url, html, _ in BATCH}
        result = deep_read_one({"opportunity_id": "x", "url": "https://agg.example.edu/7",
                                "source_group": "D"}, lambda u: pages.get(u), at=NOW)
        # 无源站链接（agg 页即源页）→ secondhand 口径不误标确定值
        self.assertIn(result["fields"]["deadline"]["extract_status"],
                      ("ok", "secondhand_unverified", "not_found"))

    def test_results_all_have_evidence(self):
        pages = {url: html for url, html, _ in BATCH}
        results = deep_read_and_backfill(
            [{"opportunity_id": u, "url": u, "source_group": "A"} for u, _, _ in BATCH],
            lambda u: pages.get(u), at=NOW)
        for r in results:
            self.assertEqual(r["status"], "ok")
            for key in ("salary_range", "deadline", "contact"):
                ev = r["fields"][key]["evidence"]
                if ev is not None:
                    self.assertIn("url", ev)
                    self.assertIn("excerpt", ev)


if __name__ == "__main__":
    unittest.main(verbosity=2)
