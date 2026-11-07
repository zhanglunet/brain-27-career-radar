#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-231/T3：学习路径生成——练什么 / 顺序 / 达标标准（trend issue #1157）。

按 T1 设计（docs/plans/2026-10-26-growth-path-design.md）§四/§五实现，消费
T2 缺口清单（gap-analysis/v1）+ SkillStandard 标准表 + 目标机会集合：

  排序原则（§5.2，优先级从高到低依次生效）：
    1. 截止日驱动：步骤按其驱动机会 deadline 升序；无 deadline 排后；
       **已过 deadline 的机会缺口不进路径**（§3.5，excluded 留痕不静默）；
    2. 依赖关系：同技能内 L1→L2→L3 严格顺序（进阶链）；跨技能依赖由标准表
       deps 声明（如「fMRI 预处理」依赖「Python 数据管线 L2」）按拓扑序排；
       **成环报错给人工，不静默乱序**；
    3. 性价比：同窗口同依赖满足的步骤按 severity ÷ effort 权重排序（又重要
       又快的先练；effortBand 只用于排序不作承诺）。
  步骤结构（§5.3 PathStep）：id/gapIds/subject/category/fromLevel/toLevel/action/
  criterion（**逐字引用标准表该级 criterion，不另行改写**——测试断言）/effortBand/
  drivenBy{opportunityId, deadline}/status=todo。
  合并（§5.4）：同 subject+同 requiredLevel 跨机会合并为一步（gapIds 收集全部
  来源、drivenBy 取最早 deadline、severity 取最大）；同 subject 不同级 → 进阶链，
  低阶步骤服务低要求机会；**合并只在同类别内**（skill 与 credential 不合并）。
  静默红线：无标准表条目的 subject 不产步骤，进 observations（standard_missing）；
  hard_gate 不进路径（T2 已单列）；标准 criterion 缺该级 → standard_level_missing。

零网络；全合成；确定性（同输入同输出，无墙钟——today 由调用方注入）。
测试：tests/test_prd231_t3_path.py
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

PATH_SCHEMA = "growth-path/v1"
EFFORT_WEIGHTS = {"S": 4.0, "M": 2.0, "L": 1.0, "XL": 0.5}  # §5.3 粗粒度，仅排序
LEVEL_WORDS = {1: "入门", 2: "熟练", 3: "可独立交付"}


class PathError(ValueError):
    """路径生成违规（依赖成环等——报错给人工，不静默乱序）。"""


def _canonical(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _step_id(subject: str, level: int, category: str) -> str:
    seed = f"{category}:{subject}:L{level}"
    return "step-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:10]


def _deadline_of(gap: dict[str, Any], opportunities: dict[str, dict[str, Any]]) -> str | None:
    opportunity = opportunities.get(gap.get("opportunityId", ""))
    return (opportunity or {}).get("deadline")


def generate_path(gaps: list[dict[str, Any]],
                  standards: dict[str, dict[str, Any]],
                  opportunities: dict[str, dict[str, Any]], *,
                  today: str) -> dict[str, Any]:
    """缺口清单 → 有序 PathStep 数组（growth-path/v1，确定性纯函数）。

    today：业务日 YYYY-MM-DD（注入）；早于它的 deadline 视为已过（§3.5）。
    standards[subject]：{levels: {"1": {criterion, evidenceKinds, action?, effortBand?}...},
    deps?: [{subject, level}]}。
    """
    observations: list[dict[str, Any]] = []
    excluded_expired: list[dict[str, Any]] = []

    # ---- ① 过滤：hard_gate（T2 已单列，此处兜底）与已过 deadline（§3.5）
    eligible: list[dict[str, Any]] = []
    for gap in gaps:
        if gap.get("category") == "hard_gate" or gap.get("status") != "open":
            continue
        deadline = _deadline_of(gap, opportunities)
        if deadline is not None and deadline < today:
            excluded_expired.append({
                "subject": gap["subject"], "opportunityId": gap.get("opportunityId", ""),
                "deadline": deadline,
                "reason": "deadline_passed",
                "note": "已过 deadline 的机会缺口不进路径（T1 §3.5）；如仍有意向请人工复核",
            })
            continue
        eligible.append(gap)

    # ---- ② 分组（§5.4）：同 (category, subject) 合并；requiredLevel → 目标级
    #      无标准表条目 → observation（不产步骤，不静默）
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for gap in eligible:
        subject = gap["subject"]
        if subject not in standards:
            observations.append({
                "kind": "standard_missing", "subject": subject,
                "note": f"{subject} 无 SkillStandard 条目：无法给可检验达标标准，"
                        "不产步骤；请先补标准表（数据不是代码，§4.2）",
            })
            continue
        grouped.setdefault((gap.get("category", "skill"), subject), []).append(gap)

    steps: list[dict[str, Any]] = []
    for (category, subject), items in sorted(grouped.items()):
        standard = standards[subject]
        levels = standard.get("levels", {})
        target_level = max(int(g["requiredLevel"]) for g in items)
        current_level = max(int(g["currentLevel"]) for g in items)
        # 进阶链（§5.4）：fromLevel+1 → targetLevel，每级一步
        for level in range(current_level + 1, target_level + 1):
            level_spec = levels.get(str(level))
            if not level_spec or not level_spec.get("criterion"):
                observations.append({
                    "kind": "standard_level_missing", "subject": subject,
                    "level": level,
                    "note": f"{subject} 标准表缺 L{level} 判据：无达标标准不产步骤（§4.2）",
                })
                continue
            # 本步同时推进的缺口（§5.3/§5.4）：所有 requiredLevel ≥ 本级的缺口——
            # 低阶一步达标连带推进高要求机会的同名缺口
            serving = [g for g in items if int(g["requiredLevel"]) >= level]
            deadlines = sorted(
                d for d in (_deadline_of(g, opportunities) for g in serving) if d)
            driver = min(
                serving,
                key=lambda g: (_deadline_of(g, opportunities) or "9999-12-31",
                                g.get("opportunityId", "")))
            severity = max(g["severity"] for g in serving)
            steps.append({
                "id": _step_id(subject, level, category),
                "gapIds": [
                    f"{g.get('opportunityId', '')}:{g['subject']}:{g['requiredLevel']}"
                    for g in serving
                ],
                "subject": subject,
                "category": category,
                "fromLevel": level - 1,
                "toLevel": level,
                "action": level_spec.get("action")
                or f"补齐 {subject} L{level}（{LEVEL_WORDS.get(level, '')}）所需证据："
                   "按达标判据执行并留可核验记录",
                "criterion": level_spec["criterion"],  # 逐字引用，不改写（§5.3）
                "effortBand": level_spec.get("effortBand", "M"),
                "drivenBy": {
                    "opportunityId": driver.get("opportunityId", ""),
                    "deadline": deadlines[0] if deadlines else None,
                },
                "status": "todo",
                "x-severity": severity,
            })

    # ---- ③ 依赖拓扑（§5.2-2）：deps 声明 → 同 subject 前置步骤须先排；
    #      成环 → PathError（报错给人工，不静默乱序）
    _check_cycles(standards)
    deps = {subject: [d for d in (std.get("deps") or []) if d["subject"] in standards]
            for subject, std in standards.items()}

    def _weight(step: dict[str, Any]) -> float:
        severity = step.get("x-severity", 0)
        return severity / EFFORT_WEIGHTS.get(step["effortBand"], 1.0)

    # ---- ④ 终排序（§5.2）：依赖是硬约束（前置未排完不可排），在其之上按
    #      deadline 升序（无 deadline 最后）→ 性价比（severity/effort 权重降序）
    #      → 主题/级别字典序（同分确定性）贪心选取；无步可选即成环 → 报错给人工
    ordered: list[dict[str, Any]] = []
    remaining = sorted(steps, key=lambda s: (s["subject"], s["toLevel"]))
    placed: list[tuple[str, int]] = []  # (subject, toLevel)
    while remaining:
        available = [
            s for s in remaining
            if all(any(p_subject == dep["subject"] and p_level >= dep.get("level", 1)
                       for p_subject, p_level in placed)
                   for dep in deps.get(s["subject"], []))
            # 同技能内 L1→L2→L3 严格顺序（§5.2-2）：低级未排完不排高级
            and not any(r["subject"] == s["subject"]
                        and r["toLevel"] < s["toLevel"] for r in remaining)
        ]
        if not available:
            raise PathError("跨技能依赖成环（或前置全部缺失）："
                            f"{sorted({s['subject'] for s in remaining})}——报错给人工，不静默乱序（§5.2-2）")
        chosen = min(available, key=lambda s: (s["drivenBy"]["deadline"] or "9999-12-31",
                                               -_weight(s), s["subject"], s["toLevel"]))
        remaining.remove(chosen)
        placed.append((chosen["subject"], chosen["toLevel"]))
        ordered.append(chosen)

    for step in ordered:
        step.pop("x-severity", None)  # 内部排序量不外泄（severity 已进 gapIds 溯源链）

    return {
        "schema": PATH_SCHEMA,
        "today": today,
        "steps": ordered,
        "observations": observations,
        "excluded": excluded_expired,
        "summary": {
            "steps_total": len(ordered),
            "subjects": len({s["subject"] for s in ordered}),
            "note": "路径是建议序不是课表：可跳过或调整，调整触发重排（§5.5，T4）；"
                    "达标只触发投递建议、不自动投递",
        },
    }


def _check_cycles(standards: dict[str, dict[str, Any]]) -> None:
    """deps 成环检测（DFS 三色）；成环抛 PathError（§5.2-2 报错给人工）。"""
    deps = {subject: [d["subject"] for d in (std.get("deps") or [])
                      if d["subject"] in standards]
            for subject, std in standards.items()}
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {s: WHITE for s in deps}

    def visit(node: str, trail: list[str]) -> None:
        color[node] = GRAY
        for dep in deps.get(node, []):
            if color.get(dep) == GRAY:
                raise PathError("标准表依赖成环: "
                                f"{' → '.join(trail + [dep])}（§5.2-2 报错给人工）")
            if color.get(dep) == WHITE:
                visit(dep, trail + [dep])
        color[node] = BLACK

    for subject in deps:
        if color[subject] == WHITE:
            visit(subject, [subject])
