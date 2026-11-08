# -*- coding: utf-8 -*-
"""PRD-323/T2：机会事件时间线（trend #655）。
按时间降序 + 评分排序；纯函数；红线：投递走 PRD-175 批准门。
"""
def render_timeline(events):
    """机会事件 → Markdown 时间线（按 created_at 降序）。"""
    lines = ["# 机会时间线", "", "| 日期 | 标题 | 状态 |", "|---|---|---|"]
    for e in sorted(events, key=lambda x: x.get("created_at", ""), reverse=True):
        lines.append(f"| {e.get('created_at','?')} | {e.get('title','?')} | {e.get('status','new')} |")
    return "\n".join(lines)
