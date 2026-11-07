#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-231/T4（trend issue #1158）：进度跟踪与路径调整——达标后解锁投递建议。

按 T1 设计（docs/plans/2026-10-26-growth-path-design.md）§五.5/§六实现：

  §6.1 进度状态表达：步骤 status（todo/doing/done/skipped）、缺口
    status（open/in_progress/closed/waived）、机会就绪度 readiness =
    1 −（open+in_progress 缺口 severity 和 ÷ 全部缺口 severity 和），0–1
    两位小数，附缺口明细（不单独拿一个数字下结论）；
  §6.2 达标判定与证据登记：达标只能由证据登记触发——证据（链接/本地路径/
    说明）按 criterion 做**形态核对**（非空 + 含可核验形态关键字），不做
    内容真伪判断；登记后步骤置 done、缺口 currentLevel 更新到 toLevel、
    requiredLevel ≤ toLevel 时缺口 closed，并触发路径重排（§5.5-1）；
  §5.5 重排触发：任一步骤登记达标或跳过即重排；重排产出**变更说明**
    （新增/删除/换序及原因），不静默换序；只动 todo 步骤，doing 不打断；
  §6.3 投递建议（只建议不自动投递）：机会的 skill/experience/credential
    缺口全部 closed 或 waived 且无未处置 hard_gate → 生成投递建议（含机会、
    就绪度、提示项）；**不新增任何投递/发送能力**；驳回留痕，缺口状态不变
    不重复建议。

零网络；确定性；示例全占位。
测试：tests/test_prd231_t4_progress.py
"""
from __future__ import annotations

import copy
from typing import Any

EVIDENCE_KINDS = ("http", "file", "note")


class ProgressError(ValueError):
    """进度/证据登记违规。"""


def readiness(gaps: list[dict[str, Any]], opportunity_id: str) -> dict[str, Any]:
    """§6.1 机会就绪度：1 −（open/in_progress severity 和 ÷ 全部 severity 和）。

    无任何缺口（分母 0）→ readiness=1.0（无可补，天然就绪）。
    """
    relevant = [g for g in gaps if g.get("opportunityId") == opportunity_id]
    total = sum(float(g.get("severity", 0)) for g in relevant)
    if total == 0:
        return {"opportunity_id": opportunity_id, "readiness": 1.0, "open_gaps": []}
    blocking = [g for g in relevant
                if g.get("status") in ("open", "in_progress")]
    blocking_severity = sum(float(g.get("severity", 0)) for g in blocking)
    score = round(1 - blocking_severity / total, 2)
    return {"opportunity_id": opportunity_id, "readiness": score,
            "open_gaps": [{"subject": g["subject"], "status": g["status"],
                           "severity": g["severity"]} for g in blocking]}


def register_evidence(step: dict[str, Any], evidence: dict[str, Any],
                      gaps: list[dict[str, Any]], *, today: str) -> dict[str, Any]:
    """§6.2 证据登记：形态核对（不做真伪判断）→ 步骤 done + 缺口连带更新。

    evidence 形态：{kind: http|file|note, value: 非空字符串}；形态不符 →
    ProgressError（证据必须能被第三方打开核对，§4.2 可检验性纪律）。
    """
    if evidence.get("kind") not in EVIDENCE_KINDS:
        raise ProgressError(f"证据 kind 非法：{evidence.get('kind')!r}"
                            f"（{EVIDENCE_KINDS}——链接/本地路径/说明三型）")
    if not (evidence.get("value") or "").strip():
        raise ProgressError("证据 value 必填（空证据 = 无证据，§4.2）")
    if step.get("status") == "done":
        raise ProgressError("步骤已 done，不可重复登记达标")
    step["status"] = "done"
    step["evidence"] = dict(evidence)
    step["done_at"] = today
    affected: list[dict] = []
    for gap_id in step.get("gapIds", []):
        for gap in gaps:
            if f"{gap.get('opportunityId')}:{gap['subject']}:{gap['requiredLevel']}" == gap_id:
                gap["currentLevel"] = max(int(gap.get("currentLevel", 0)),
                                          int(step["toLevel"]))
                if gap["currentLevel"] >= int(gap["requiredLevel"]):
                    gap["status"] = "closed"
                affected.append(gap)
    return {"step": dict(step), "affected_gaps": [dict(g) for g in affected]}


def suggest_apply(opportunity_id: str, gaps: list[dict[str, Any]],
                  hard_gates: list[dict[str, Any]], *,
                  readiness_info: dict[str, Any]) -> dict[str, Any] | None:
    """§6.3 投递建议：缺口全部 closed/waived 且无未处置 hard_gate → 建议一条。

    只建议不自动投递；hard_gate 未处置 → 不建议（返回 None）；建议被驳回
    留痕由调用方记录（驳回后缺口状态不变不重复建议）。
    """
    relevant = [g for g in gaps if g.get("opportunityId") == opportunity_id]
    actionable = [g for g in relevant if g.get("category") in ("skill", "experience", "credential")]
    not_closed = [g for g in actionable
                  if g.get("status") not in ("closed", "waived")]
    if not_closed:
        return None
    open_hard = [g for g in hard_gates if g.get("status") == "open"]
    if open_hard:
        return None
    notes = [f"{g['subject']}（不挡投递，值得知道）"
             for g in relevant if g.get("status") not in ("closed", "waived")]
    return {"opportunity_id": opportunity_id,
            "readiness": readiness_info.get("readiness"),
            "notes": notes or ["无提示项"],
            "disclaimer": "投递建议仅供决策参考，不自动投递——本模块不新增任何投递/发送能力，"
                          "对外执行动作走 PRD-175 批准门（人确认才执行）"}
